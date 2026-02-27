import { createFileRoute } from "@tanstack/react-router";
import { useSelectedWalletAccount } from "@solana/react";
import { useWalletAccountTransactionSendingSigner } from "@solana/react";
import {
  type Address,
  address,
  fetchEncodedAccount,
} from "@solana/kit";
import { useCallback, useEffect, useState } from "react";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";

import {
  type RedPacketAccount,
  PROGRAM_ID,
  TOKEN_TYPE_SOL,
  decodeRedPacket,
  findRedPacketPDA,
  findVaultPDA,
  buildCloseInstruction,
  formatAmount,
  getRedPacketStatus,
} from "@/lib/program";
import { getAssociatedTokenAddress } from "@/lib/ata";
import { sendTransaction } from "@/lib/transaction";
import { rpc } from "@/lib/rpc";

export const Route = createFileRoute("/dashboard")({
  component: DashboardPage,
});

interface RedPacketWithPDA extends RedPacketAccount {
  pda: Address;
}

function DashboardPage() {
  const [selectedAccount] = useSelectedWalletAccount();
  const [packets, setPackets] = useState<RedPacketWithPDA[]>([]);
  const [loading, setLoading] = useState(false);

  const fetchPackets = useCallback(async () => {
    if (!selectedAccount) return;
    setLoading(true);
    try {
      // Discriminator 1 byte [0x01] = base58 "2"
      // Creator pubkey is already a base58 address string
      const result = await rpc
        .getProgramAccounts(PROGRAM_ID, {
          encoding: "base64",
          filters: [
            {
              memcmp: {
                offset: 0n,
                bytes: "2" as never, // discriminator=1 in base58
                encoding: "base58",
              },
            },
            {
              memcmp: {
                offset: 1n,
                bytes: selectedAccount.address as never,
                encoding: "base58",
              },
            },
          ],
        })
        .send();

      const decoded: RedPacketWithPDA[] = [];
      for (const item of result) {
        try {
          const rawData = (item as { account: { data: unknown }; pubkey: string }).account.data;
          let data: Uint8Array;
          if (Array.isArray(rawData)) {
            data = Uint8Array.from(atob(rawData[0] as string), (c) =>
              c.charCodeAt(0)
            );
          } else {
            data = new Uint8Array(rawData as ArrayBuffer);
          }
          const rp = decodeRedPacket(data);
          decoded.push({ ...rp, pda: (item as { pubkey: string }).pubkey as Address });
        } catch {
          // Skip malformed accounts
        }
      }

      decoded.sort((a, b) => (a.id > b.id ? -1 : 1));
      setPackets(decoded);
    } catch (e) {
      console.error("Failed to fetch packets", e);
      toast.error("Failed to fetch red packets");
    } finally {
      setLoading(false);
    }
  }, [selectedAccount?.address]);

  useEffect(() => {
    fetchPackets();
  }, [fetchPackets]);

  if (!selectedAccount) {
    return (
      <div className="space-y-6">
        <h1 className="text-2xl font-bold">My Red Packets</h1>
        <Card>
          <CardContent className="py-12 text-center text-muted-foreground">
            Connect your wallet to view your red packets.
          </CardContent>
        </Card>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-bold">My Red Packets</h1>
        <Button variant="outline" size="sm" onClick={fetchPackets}>
          Refresh
        </Button>
      </div>

      {loading ? (
        <p className="text-muted-foreground">Loading...</p>
      ) : packets.length === 0 ? (
        <Card>
          <CardContent className="py-12 text-center text-muted-foreground">
            No red packets found. Create one first!
          </CardContent>
        </Card>
      ) : (
        <div className="space-y-4">
          {packets.map((rp) => (
            <PacketCard
              key={String(rp.id)}
              rp={rp}
              account={selectedAccount}
              onClose={fetchPackets}
            />
          ))}
        </div>
      )}
    </div>
  );
}

function PacketCard({
  rp,
  account,
  onClose,
}: {
  rp: RedPacketWithPDA;
  account: NonNullable<ReturnType<typeof useSelectedWalletAccount>[0]>;
  onClose: () => void;
}) {
  const signer = useWalletAccountTransactionSendingSigner(
    account,
    "solana:devnet"
  );
  const [isClosing, setIsClosing] = useState(false);

  const isSol = rp.tokenType === TOKEN_TYPE_SOL;
  const decimals = isSol ? 9 : 6;
  const nowUnix = Math.floor(Date.now() / 1000);
  const status = getRedPacketStatus(rp, nowUnix);
  const canClose = status === "expired" || status === "fully_claimed";

  const claimUrl = `${window.location.origin}/claim/${rp.creator}/${rp.id}`;

  async function handleClose() {
    setIsClosing(true);
    try {
      const creatorAddress = address(account.address);
      const [rpPDA] = await findRedPacketPDA(creatorAddress, rp.id);
      const [vaultPDA] = await findVaultPDA(creatorAddress, rp.id);

      let creatorTokenAccount: Address | undefined;
      if (!isSol) {
        const vaultAccount = await fetchEncodedAccount(rpc, vaultPDA);
        if (vaultAccount.exists) {
          const vaultData = new Uint8Array(vaultAccount.data);
          const { getAddressDecoder } = await import("@solana/kit");
          const mintAddr = getAddressDecoder().decode(vaultData.slice(0, 32));
          creatorTokenAccount = await getAssociatedTokenAddress(
            creatorAddress,
            mintAddr
          );
        }
      }

      const ix = buildCloseInstruction({
        tokenType: rp.tokenType,
        creator: creatorAddress,
        creatorTokenAccount,
        redPacket: rpPDA,
        vault: vaultPDA,
      });

      await sendTransaction(signer, [ix]);
      toast.success("Red packet closed, funds reclaimed!");
      onClose();
    } catch (e: unknown) {
      const msg = e instanceof Error ? e.message : "Close failed";
      toast.error(msg);
    } finally {
      setIsClosing(false);
    }
  }

  return (
    <Card>
      <CardHeader>
        <div className="flex items-center justify-between">
          <CardTitle className="text-base">
            {formatAmount(rp.totalAmount, rp.tokenType, decimals)}
          </CardTitle>
          <Badge
            variant={
              status === "active"
                ? "default"
                : status === "expired"
                  ? "destructive"
                  : "secondary"
            }
          >
            {status === "active"
              ? "Active"
              : status === "expired"
                ? "Expired"
                : "Fully Claimed"}
          </Badge>
        </div>
        <CardDescription>
          ID: {String(rp.id)} &middot; {rp.numClaimed}/{rp.numRecipients}{" "}
          claimed &middot;{" "}
          {rp.splitMode === 0 ? "Even" : "Random"}
        </CardDescription>
      </CardHeader>
      <CardContent className="flex gap-2">
        <Button
          variant="outline"
          size="sm"
          onClick={() => {
            navigator.clipboard.writeText(claimUrl);
            toast.success("Link copied!");
          }}
        >
          Copy Link
        </Button>
        {canClose && (
          <Button
            variant="destructive"
            size="sm"
            onClick={handleClose}
            disabled={isClosing}
          >
            {isClosing ? "Closing..." : "Close & Reclaim"}
          </Button>
        )}
      </CardContent>
    </Card>
  );
}
