# Red Packet (Hongbao)

On-chain red packets for Solana — send SOL (or any SPL token) to friends and let them claim their share via a shareable link or blink.

## Live Demo

- **Frontend**: https://redpackets.space
- **Blinks Server**: https://blinks.redpackets.space
- **Program (Devnet)**: `CeAkHjhJzgrwbg8QWQ8tx6h5UxMZVKuGBeEDYczbc6Gz`

## How It Works

1. **Create** a red packet on the website — choose amount, number of recipients, split mode (even/random), and expiry
2. **Share** the claim link or blink URL with friends
3. **Claim** — recipients open the link, connect their wallet, and claim their share
4. **Close** — after expiry or all claimed, creator reclaims any leftover funds

### User Flow

```
Creator → Website → Create Red Packet → Get Claim URL + Blink URL
                                              ↓
Recipients → Open Link → Connect Wallet → Claim SOL/SPL
                                              ↓
Creator → Dashboard → Close Expired Packets → Reclaim Leftovers
```

## Architecture

### On-Chain Program (`programs/solana-redpacket/`)

Built with **Pinocchio** (zero-dependency, zero-copy Solana framework) — not Anchor. Hand-optimized to **57,200 bytes**.

- Native SOL + any SPL token (USDC, etc.) with per-mint treasury PDAs
- 0.1% fee collection with admin withdrawal
- Even or random split modes, max 20 recipients per packet
- Expiry-based lifecycle with creator close/reclaim
- 63 tests covering all 22 error variants using LiteSVM

### Frontend (`app/`)

- **TanStack Start** (SSR, file-based routing) + **Tailwind v4** + **shadcn/ui**
- **@solana/kit** v6 + **@solana/react** + **wallet-standard** for wallet integration
- No database — all state is read from on-chain accounts
- Routes: Create, Claim (`/claim/<creator>/<id>`), Dashboard, Admin

### Blinks Server (`blinks/`)

Rust **Axum** server implementing the **Solana Actions** spec. Returns unsigned transactions that any Actions-compatible client can sign and submit.

- Built using [Orbitflare's Solana Blinks Axum template](https://github.com/nicholasgasior/orbitflare/tree/main/templates/solana-blinks-axum)
- 3 actions: Create, Claim, Close — SOL only for the blinks MVP
- 82/82 e2e assertions passing on devnet (11 test scenarios)
- Shareable claim blinks: `{BASE_URL}/api/actions/claim?creator=X&id=Y`

## Tech Stack

| Component | Technology |
|-----------|-----------|
| On-chain program | Rust, Pinocchio, Solana BPF |
| Frontend | TanStack Start, React, Tailwind v4, shadcn/ui |
| Wallet | @solana/kit, @solana/react, wallet-standard |
| Blinks server | Rust, Axum, tokio, solana-sdk |
| RPC | Helius (devnet) |
| Frontend hosting | Vercel |
| Blinks hosting | Hetzner VPS |

## Sponsors

- **Solana Foundation** — Main track. On-chain program built natively with Pinocchio, deployed to devnet.
- **Orbitflare** — Blinks server built using Orbitflare's [Solana Blinks Axum template](https://github.com/nicholasgasior/orbitflare/tree/main/templates/solana-blinks-axum), implementing the Solana Actions spec for shareable claim blinks.

## Roadmap

- Mainnet deployment
- SPL token support in blinks (currently SOL only)
- Red packet themes and custom messages
- Batch create (multiple packets in one tx)
- Mobile-optimized claim experience

## Development

```bash
# Program
yarn build                # cargo build-sbf
yarn test                 # build + run all 63 tests

# Frontend
cd app && yarn dev        # dev server on localhost:3000

# Blinks server
cd blinks && cargo run --release   # starts on 0.0.0.0:3001

# E2E test (needs blinks server running + program on devnet)
cd blinks/scripts && npx tsx e2e-test.ts
```

## Project Structure

```
├── programs/solana-redpacket/   # On-chain Pinocchio program
│   └── src/
│       ├── lib.rs               # Entrypoint + instruction routing
│       ├── state.rs             # Account data layouts
│       ├── constants.rs         # PDAs, admin, rent calc
│       ├── error.rs             # 22 error variants
│       └── instructions/        # create, claim, close, init_treasury, withdraw_fees
├── tests/                       # 63 LiteSVM tests
├── app/                         # TanStack Start frontend
│   └── src/
│       ├── lib/program.ts       # Client SDK (PDA, instruction builders, decoders)
│       └── routes/              # Create, Claim, Dashboard, Admin
├── blinks/                      # Rust Axum blinks server
│   └── src/
│       ├── actions/             # create, claim, close action handlers
│       ├── program.rs           # Rust PDA + instruction builders
│       └── router.rs            # Axum routes + Solana Actions spec
└── demo/                        # Remotion demo video
```
