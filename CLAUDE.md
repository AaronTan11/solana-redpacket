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
- **Admin pubkey** for fee withdrawal is hardcoded in `constants.rs` (placeholder: `ADMNqGCquVC3xPkhttaUSCMFhSmu3rBVsRRBKjLFMbhg`).
- **SOL defense-in-depth**: SOL claim/close verify `vault.owned_by(&ID)` since there's no token program CPI to enforce ownership.
- **overflow-checks = false**: Safe because all arithmetic uses explicit `.checked_add/sub/mul()` with `ArithmeticOverflow` error handling. Unchecked operations are bounded by construction (e.g., index math capped at 231, counters capped at 20).
- **Rent hardcoded**: `rent_exempt()` const fn in `constants.rs` uses formula `(data_len + 128) * 2 * 3480`. Avoids Rent sysvar syscall overhead. Values stable since Solana genesis.

### Tests (`tests/solana-redpacket.ts`)

Uses **LiteSVM** (in-memory SVM, no validator needed). The `setupSVM()` helper creates mock USDC + MYRC mints and initializes 3 treasuries (USDC, MYRC, SOL), returning a ready-to-use test environment. All instruction data is built manually matching the on-chain byte layout. Data builders accept `tokenType` parameter (default `0` for SPL). 31 tests: 19 USDC + 4 MYRC + 8 SOL.

### Dependencies

- `pinocchio` 0.10 (core framework + CPI)
- `pinocchio-system` 0.5 (CreateAccount CPI)
- `pinocchio-token` 0.5 (Transfer, InitializeAccount3, CloseAccount CPI)
- `five8_const` 0.1 (compile-time base58 decoding for addresses)
