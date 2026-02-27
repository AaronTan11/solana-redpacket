# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Build & Test Commands

```bash
yarn build                # cargo build-sbf for the Solana program
yarn test                 # build + run all tests
yarn lint                 # prettier check
yarn lint:fix             # prettier fix

# Run a single test by name
yarn build && yarn run ts-mocha -p ./tsconfig.json -t 1000000 'tests/**/*.ts' --grep "Creates red packet"
```

## Logging

Logging is behind a feature flag. Production builds omit all log strings for smaller binary:
```bash
cargo build-sbf                      # production (no logs, smaller binary)
cargo build-sbf --features logging   # debug (includes sol_log_ calls)
```

Package manager: **Yarn 4.12.0**. Rust toolchain: **1.89.0** (set in `rust-toolchain.toml`).

## Architecture

Solana program built with **Pinocchio** (zero-dependency, zero-copy framework) — not Anchor. All account parsing is manual byte-offset reads. Binary optimized for size (`opt-level = "z"`, `lto = "fat"`, `strip = true`, `panic = "abort"`, `overflow-checks = false`). Uses decomposed entrypoint (`program_entrypoint!` + `no_allocator!` + `default_panic_handler!`) and feature-gated `sol_log_` syscall for logging — no heap allocations anywhere. Rent-exempt minimums use a const fn (`rent_exempt()` in `constants.rs`) instead of the Rent sysvar syscall.

### Program: `programs/solana-redpacket/`

Red packet (hongbao) system supporting **native SOL** and **multiple SPL tokens** (USDC, MYRC, or any mint) with 0.1% fee collection. Each SPL mint gets its own treasury + treasury_vault via per-mint PDA derivation. SOL gets a treasury (no vault) using a `NATIVE_SOL_MINT` sentinel (`[0xFF; 32]`). The accepted SPL mint is NOT hardcoded — it's stored in the treasury PDA at initialization time.

**Instruction routing** (`lib.rs`): single-byte discriminator → handler function. Instructions 0/1/2/4 branch internally on a `token_type` byte in instruction data (`0`=SPL, `1`=SOL).

| Disc | Instruction | SPL Accounts (token_type=0) | SOL Accounts (token_type=1) |
|------|-------------|----------------------------|----------------------------|
| 0 | `create` | creator, creator_ta, red_packet, vault, treasury, treasury_vault, mint, token_program, system_program (9) | creator, red_packet, vault, treasury, system_program (5) |
| 1 | `claim` | claimer, claimer_ta, red_packet, vault, token_program (5) | claimer, red_packet, vault (3) |
| 2 | `close` | creator, creator_ta, red_packet, vault, token_program (5) | creator, red_packet, vault (3) |
| 3 | `init_treasury` | payer, treasury, treasury_vault, mint, token_program, system_program (6) | payer, treasury, system_program (3) |
| 4 | `withdraw_fees` | admin, admin_ta, treasury, treasury_vault, token_program (5) | admin, treasury (2) |

### PDA Seeds

- Red Packet: `["redpacket", creator_pubkey, id.to_le_bytes()]` + bump
- Vault: `["vault", creator_pubkey, id.to_le_bytes()]` + bump
- Treasury: `["treasury", mint_pubkey_or_sentinel]` + bump (per-mint; SOL uses `NATIVE_SOL_MINT` = `[0xFF; 32]`)
- Treasury Vault (SPL only): `["treasury_vault", mint_pubkey]` + bump

**SPL vault**: 165-byte token account owned by TOKEN_PROGRAM_ID; SPL owner is the red_packet PDA (signs transfers via `invoke_signed`). **SOL vault**: 0-byte account owned by the program; holds SOL as excess lamports above rent-exempt minimum. SOL transfers use direct lamport manipulation (no CPI needed for program-owned accounts). **Treasury vault** SPL owner is the treasury PDA.

### Account Data Layouts (`state.rs`)

**RedPacket** — 71 + 40*N bytes (discriminator=1):
```
 0  discriminator(1) | 1  creator(32) | 33 id(u64) | 41 total_amount(u64)
49  remaining_amount(u64) | 57 num_recipients(u8) | 58 num_claimed(u8)
59  split_mode(u8) | 60 bump(u8) | 61 vault_bump(u8) | 62 token_type(u8)
63  expires_at(i64) | 71 amounts[N](u64 each) | 71+8N claimers[N](32 each)
```

**Treasury** — 43 bytes (discriminator=2):
```
 0  discriminator(1) | 1  bump(u8) | 2  vault_bump(u8) | 3  mint(32)
35  sol_fees_collected(u64)
```

### Key Design Decisions

- **User-supplied bumps**: `create` and `init_treasury` receive bumps in instruction data. The program verifies them via `Address::create_program_address` — never trusts blindly.
- **Token types**: `0` = SPL (any mint — USDC, MYRC, etc.), `1` = SOL. Stored in red packet state; instruction data `token_type` is verified against stored value on claim/close/withdraw.
- **Fee**: `max(1, total_amount * 10 / 10_000)` — 0.1% with minimum 1 micro-unit. SPL fees go to treasury_vault; SOL fees go to treasury PDA lamports (tracked via `sol_fees_collected`).
- **SOL fee withdrawal**: Available = `min(sol_fees_collected, treasury.lamports - rent_exempt)`. Prevents withdrawing rent from treasury.
- **Split modes**: 0 = even (program computes), 1 = random (client pre-computes amounts in instruction data).
- **Max 20 recipients** per red packet.
- **Admin pubkey** for fee withdrawal is hardcoded in `constants.rs` (`HyBxuaafzKP6k4zkEDUp4LrZctS9mJVNUEEJBmp9cp7L`). The matching secret key is in the test file as `ADMIN_KEYPAIR`.
- **SOL defense-in-depth**: SOL claim/close verify `vault.owned_by(&ID)` since there's no token program CPI to enforce ownership.
- **overflow-checks = false**: Safe because all arithmetic uses explicit `.checked_add/sub/mul()` with `ArithmeticOverflow` error handling. Unchecked operations are bounded by construction (e.g., index math capped at 231, counters capped at 20).
- **Rent hardcoded**: `rent_exempt()` const fn in `constants.rs` uses formula `(data_len + 128) * 2 * 3480`. Avoids Rent sysvar syscall overhead. Values stable since Solana genesis.

### Tests (`tests/solana-redpacket.ts`)

Uses **LiteSVM** (in-memory SVM, no validator needed). The `setupSVM()` helper creates mock USDC + MYRC mints and initializes 3 treasuries (USDC, MYRC, SOL), returning a ready-to-use test environment. All instruction data is built manually matching the on-chain byte layout. Data builders accept `tokenType` parameter (default `0` for SPL). 63 tests covering all 22/22 error variants. Breakdown: 19 USDC + 4 MYRC + 8 SOL core, 7 fee withdrawal, 5 input validation, 2 edge cases, 1 SOL lifecycle, 1 SOL treasury init, 8 security guards, 8 remaining validation paths (NotEnoughAccounts, InvalidTokenAccount, zero-slot random split, invalid token_type value, SOL expired claim, SOL excess withdrawal, close fake token program, truncated data).

### Frontend: `app/`

TanStack Start + shadcn/ui (Lyra style, red theme) + `@solana/kit` + `@solana/react` + `wallet-standard`. No database — all state on-chain. Shareable claim URLs: `/claim/<creator_pubkey>/<id>`.

```bash
cd app && yarn dev     # dev server on localhost:3000
cd app && npx tsc --noEmit  # type-check
```

**Stack**: TanStack Start (file-based routing, SSR-capable), Tailwind v4, shadcn/ui (Radix), `@solana/kit` v6 (RPC, codecs, transaction building), `@solana/react` (wallet hooks), `@wallet-standard/react` (wallet discovery). Uses `node-modules` linker (`.yarnrc.yml`).

**Key files**:
- `app/src/lib/program.ts` — Client SDK: PDA derivation (`findRedPacketPDA`, `findVaultPDA`, `findTreasuryPDA`, `findTreasuryVaultPDA`), instruction builders (`buildCreateInstruction`, `buildClaimInstruction`, `buildCloseInstruction`, `buildInitTreasuryInstruction`, `buildWithdrawFeesInstruction`), account decoders (`decodeRedPacket`, `decodeTreasury`), helpers (`computeFee`, `generateRandomSplit`, `formatAmount`, `getRedPacketStatus`)
- `app/src/lib/rpc.ts` — RPC context (`VITE_RPC_URL` env var, devnet fallback)
- `app/src/lib/transaction.ts` — `sendTransaction(signer, instructions[])` using kit's pipe pattern
- `app/src/lib/ata.ts` — Associated Token Address derivation
- `app/src/components/providers.tsx` — `SelectedWalletAccountContextProvider` + RPC provider with localStorage wallet persistence
- `app/src/components/connect-wallet.tsx` — Wallet connect dropdown (shadcn DropdownMenu)

**Routes** (`app/src/routes/`):
- `__root.tsx` — Root layout: navbar (Create, Dashboard, Admin gated to admin wallet) + wallet button + Toaster
- `index.tsx` — Create red packet form (SOL/SPL toggle, amount, recipients, split mode, expiry). Success card shows both website claim URL and blink claim URL (`BLINKS_BASE_URL` from `VITE_BLINKS_URL` env var)
- `claim.$creator.$id.tsx` — Claim page (fetches on-chain state, shows slots, claim button)
- `dashboard.tsx` — My Red Packets via `getProgramAccounts` + memcmp filter on creator
- `admin.tsx` — Admin fee withdrawal (gated by ADMIN pubkey)

**Wallet pattern**: `useSelectedWalletAccount()` returns `[account, setAccount, wallets]`. Signer obtained via `useWalletAccountTransactionSendingSigner(account, 'solana:devnet')` at component level, used in async handlers. Transaction flow: `pipe(createTransactionMessage → setFeePayerSigner → setBlockhashLifetime → appendInstruction) → signAndSendTransactionMessageWithSigners`.

### Blinks Server: `blinks/`

Rust Axum server implementing the [Solana Actions spec](https://solana.com/docs/advanced/actions). Returns unsigned transactions that any Actions-compatible client can sign and submit. **SOL only** for the blinks MVP. Based on `orbitflare/templates/solana-blinks-axum` patterns. E2E tested on devnet (82/82 assertions, 11 test scenarios).

```bash
cd blinks && cargo run --release    # starts on 0.0.0.0:3001
cd blinks/scripts && npx tsx e2e-test.ts  # e2e test (needs server running + program deployed)
```

**Actions** (3 endpoints, all under `/api/actions/`):

| Action | GET | POST |
|--------|-----|------|
| `create` | Form: amount, recipients, split mode, expiry | Builds SOL create tx, returns shareable claim URL |
| `claim?creator=X&id=Y` | Fetches on-chain state, shows slots/remaining/status | Builds claim tx with correct slot_index |
| `close?creator=X&id=Y` | Shows status, disabled if still active | Builds close tx (creator only) |

The claim URL (`{BASE_URL}/api/actions/claim?creator=X&id=Y`) is the shareable blink.

**Key files**:
- `blinks/src/program.rs` — Rust PDA derivation, instruction data builders, account deserialization (mirrors `app/src/lib/program.ts`)
- `blinks/src/actions/create.rs`, `claim.rs`, `close.rs` — Action implementations
- `blinks/src/router.rs` — Axum routes + Action trait with `metadata()` and `execute()` (both receive query params)
- `blinks/src/consts.rs` — Program ID, seeds, constants
- `blinks/scripts/init-treasury.ts` — One-off SOL treasury init on devnet
- `blinks/scripts/e2e-test.ts` — Comprehensive e2e test (82 assertions): even split, random split, single/max recipients, expiry, double claim rejection, non-creator close, active close, fee accumulation, metadata, nonexistent packet

**Config** (env vars or `.env`): `RPC_URL`, `HOST`, `PORT`, `BASE_URL`. Uses `CommitmentConfig::confirmed()` for RPC (important for devnet consistency).

**Workspace**: `blinks/` is **excluded** from the root Cargo workspace (different dependency tree from the Pinocchio program). Has its own `Cargo.toml` with axum, tokio, solana-sdk, solana-client.

### Deploy

**Program**: `CeAkHjhJzgrwbg8QWQ8tx6h5UxMZVKuGBeEDYczbc6Gz` (keypair at `target/deploy/solana_redpacket-keypair.json`). Deployed to **devnet**. Upgrade authority: `4MvyqHPLuGnHTcRBnyzboEkyJePr2VQv7AeDxKSQyvXm`.

Binary: **57,200 bytes**. Permanent rent: **~0.80 SOL** (with `--max-len 114400` for 2x upgrade headroom).

```bash
cargo build-sbf
solana program deploy target/deploy/solana_redpacket.so \
  --program-id target/deploy/solana_redpacket-keypair.json \
  --max-len 114400
```

**Frontend**: Deployed on Vercel at **https://solana-redpacket.vercel.app**. SSR via TanStack Start + Nitro.

```bash
cd app && vercel --prod   # deploy to production
```

Env vars (set in Vercel dashboard, not in code):
- `VITE_RPC_URL` — Helius devnet RPC (has API key, never commit)
- `VITE_WS_URL` — WebSocket RPC (optional, falls back to public devnet)
- `VITE_BLINKS_URL` — Blinks server base URL (optional, falls back to `http://46.62.206.161`)

**Blinks server**: Deployed on Hetzner VPS at **http://46.62.206.161** (Ubuntu 24.04 aarch64). Runs as systemd service `redpacket-blinks`.

```bash
# On VPS (ssh root@46.62.206.161)
systemctl status redpacket-blinks   # check status
journalctl -u redpacket-blinks -f   # tail logs
systemctl restart redpacket-blinks  # restart

# Redeploy: build locally won't work (macOS → aarch64 Linux). Build on VPS:
rsync -avz --exclude target --exclude .env blinks/ root@46.62.206.161:/opt/blinks/src/
ssh root@46.62.206.161 'source ~/.cargo/env && cd /opt/blinks/src && cargo build --release && cp target/release/redpacket-blinks /usr/local/bin/ && systemctl restart redpacket-blinks'
```

Env vars at `/opt/blinks/.env`: `RPC_URL` (Helius devnet), `HOST=0.0.0.0`, `PORT=80`, `BASE_URL=http://46.62.206.161`. Port 3001 is blocked by Hetzner's network firewall — server runs on port 80 directly. No domain/HTTPS yet — add Caddy reverse proxy when domain is available.

**Devnet setup** (one-time after deploy):
1. Initialize SOL treasury: `cd blinks/scripts && npx tsx init-treasury.ts`
2. SOL Treasury PDA: `9ksFA6SR9vmhWpJmKYkLhGsUkSN89Dxz5x68Am9wA3kB`

### Demo Video: `demo/`

Programmatic demo video built with **Remotion** (React-based video creation). 7 scenes at 1920x1080, 30fps, ~47s total. Features browser frame walkthrough with animated cursor, click effects, and zoom.

```bash
cd demo && npm install            # install deps
cd demo && npx remotion studio    # preview in browser
cd demo && npx remotion render src/index.ts DemoVideo out/demo-video.mp4  # render
```

**Scenes** (in `demo/src/scenes/`):
1. `TitleScene` — Logo + tagline (2.5s)
2. `ProblemSolutionScene` — Problem → solution text (4s)
3. `BrowserCreateScene` — Browser frame, cursor fills create form, clicks create, success card (12s)
4. `BrowserClaimScene` — Browser frame, claim page, cursor claims slot (12s)
5. `BlinksScene` — Blink card preview + shareable URL (6s)
6. `ArchTechScene` — Architecture diagram → tech stack grid (8s)
7. `SponsorsOutroScene` — Sponsors (SF + Orbitflare) → outro links (5s)

**Reusable components** (`demo/src/components/`):
- `BrowserFrame` — Mock Chrome window with traffic lights + address bar
- `Cursor` — Spring-physics animated cursor following keypoints
- `ClickEffect` — Expanding ripple at click positions
- `ZoomContainer` — Smooth zoom in/hold/zoom out wrapper

**Audio** (wired but commented out in `DemoVideo.tsx` until files provided):
- Background music: `demo/public/bgm.mp3` (user provides, royalty-free from Pixabay)
- Voiceover: `demo/public/vo-1.mp3` through `vo-7.mp3` (user generates via ElevenLabs TTS)

**Screenshots**: `demo/public/ss-*.png` captured via Playwright (`demo/scripts/screenshots.ts`) from the live site.

**Stack**: remotion 4.0.429, @remotion/transitions (fade/slide), @remotion/google-fonts, @remotion/media (audio), playwright (screenshots).

### Dependencies

- `pinocchio` 0.10 (core framework + CPI)
- `pinocchio-system` 0.5 (CreateAccount CPI)
- `pinocchio-token` 0.5 (Transfer, InitializeAccount3, CloseAccount CPI)
- `five8_const` 0.1 (compile-time base58 decoding for addresses)
