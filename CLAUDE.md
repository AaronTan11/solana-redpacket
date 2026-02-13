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

Package manager: **Yarn 4.12.0**. Rust toolchain: **1.89.0** (set in `rust-toolchain.toml`).

## Architecture

Solana program built with **Pinocchio** (zero-dependency, zero-copy framework) — not Anchor. All account parsing is manual byte-offset reads. Binary optimized for size (`opt-level = "z"`, `lto = "fat"`, `strip = true`).

### Program: `programs/solana-redpacket/`

USDC-only red packet (hongbao) system with 0.1% fee collection. The accepted token mint is NOT hardcoded — it's stored in the treasury PDA at initialization time, which allows tests to use a mock mint.

**Instruction routing** (`lib.rs`): single-byte discriminator → handler function.

| Disc | Instruction | Accounts |
|------|-------------|----------|
| 0 | `create` | creator, creator_token_acct, red_packet, vault, treasury, treasury_vault, mint, token_program, system_program |
| 1 | `claim` | claimer, claimer_token_acct, red_packet, vault, token_program |
| 2 | `close` | creator, creator_token_acct, red_packet, vault, token_program |
| 3 | `init_treasury` | payer, treasury, treasury_vault, mint, token_program, system_program |
| 4 | `withdraw_fees` | admin, admin_token_acct, treasury, treasury_vault, token_program |

### PDA Seeds

- Red Packet: `["redpacket", creator_pubkey, id.to_le_bytes()]` + bump
- Vault (SPL token account holding USDC): `["vault", creator_pubkey, id.to_le_bytes()]` + bump
- Treasury: `["treasury"]` + bump
- Treasury Vault: `["treasury_vault"]` + bump

The **vault** token account's SPL owner is the red_packet PDA (so it can sign transfers out via `invoke_signed`). The **treasury_vault** token account's SPL owner is the treasury PDA.

### Account Data Layouts (`state.rs`)

**RedPacket** — 70 + 40*N bytes (discriminator=1):
```
 0  discriminator(1) | 1  creator(32) | 33 id(u64) | 41 total_amount(u64)
49  remaining_amount(u64) | 57 num_recipients(u8) | 58 num_claimed(u8)
59  split_mode(u8) | 60 bump(u8) | 61 vault_bump(u8) | 62 expires_at(i64)
70  amounts[N](u64 each) | 70+8N claimers[N](32 each)
```

**Treasury** — 35 bytes (discriminator=2):
```
 0  discriminator(1) | 1  bump(u8) | 2  vault_bump(u8) | 3  mint(32)
```

### Key Design Decisions

- **User-supplied bumps**: `create` and `init_treasury` receive bumps in instruction data. The program verifies them via `Address::create_program_address` — never trusts blindly.
- **Fee**: `max(1, total_amount * 10 / 10_000)` — 0.1% with minimum 1 micro-unit. Transferred to treasury_vault on creation.
- **Split modes**: 0 = even (program computes), 1 = random (client pre-computes amounts in instruction data).
- **Max 20 recipients** per red packet.
- **Admin pubkey** for fee withdrawal is hardcoded in `constants.rs` (placeholder: `ADMNqGCquVC3xPkhttaUSCMFhSmu3rBVsRRBKjLFMbhg`).

### Tests (`tests/solana-redpacket.ts`)

Uses **LiteSVM** (in-memory SVM, no validator needed). The `setupSVM()` helper creates a mock USDC mint and initializes the treasury, returning a ready-to-use test environment. All instruction data is built manually matching the on-chain byte layout.

### Dependencies

- `pinocchio` 0.10 (core framework + CPI)
- `pinocchio-system` 0.5 (CreateAccount CPI)
- `pinocchio-token` 0.5 (Transfer, InitializeAccount3, CloseAccount CPI)
- `solana-program-log` 1.1 (logging)
- `five8_const` 0.1 (compile-time base58 decoding for addresses)
