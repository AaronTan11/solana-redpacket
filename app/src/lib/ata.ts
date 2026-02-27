import {
  type Address,
  address,
  getAddressEncoder,
  getProgramDerivedAddress,
} from "@solana/kit";

const ATA_PROGRAM = address("ATokenGPvbdGVxr1b2hvZbsiqW5xWH25efTNsLJA8knL");
const TOKEN_PROGRAM = address("TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA");
const encoder = getAddressEncoder();

export async function getAssociatedTokenAddress(
  wallet: Address,
  mint: Address
): Promise<Address> {
  const [ata] = await getProgramDerivedAddress({
    programAddress: ATA_PROGRAM,
    seeds: [
      encoder.encode(wallet),
      encoder.encode(TOKEN_PROGRAM),
      encoder.encode(mint),
    ],
  });
  return ata;
}
