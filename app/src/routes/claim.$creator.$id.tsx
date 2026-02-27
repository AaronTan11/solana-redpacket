import { createFileRoute } from "@tanstack/react-router";
import { useSelectedWalletAccount } from "@solana/react";
import { useWalletAccountTransactionSendingSigner } from "@solana/react";
import { type Address, address, fetchEncodedAccount } from "@solana/kit";
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
  TOKEN_TYPE_SOL,
  findRedPacketPDA,
  findVaultPDA,
  decodeRedPacket,
  buildClaimInstruction,
  formatAmount,
  getRedPacketStatus,
} from "@/lib/program";
import { getAssociatedTokenAddress } from "@/lib/ata";
import { sendTransaction } from "@/lib/transaction";
import { rpc } from "@/lib/rpc";

export const Route = createFileRoute("/claim/$creator/$id")({
  component: ClaimPage,
});

function ClaimPage() {
  const { creator, id } = Route.useParams();
  const [selectedAccount] = useSelectedWalletAccount();
  const [redPacket, setRedPacket] = useState<RedPacketAccount | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const creatorAddress = address(creator);
  const packetId = BigInt(id);

  const fetchData = useCallback(async () => {
    try {
      setLoading(true);
      const [rpPDA] = await findRedPacketPDA(creatorAddress, packetId);
      const account = await fetchEncodedAccount(rpc, rpPDA);
      if (!account.exists) {
        setError("Red packet not found");
        return;
      }
      setRedPacket(decodeRedPacket(new Uint8Array(account.data)));
      setError(null);
    } catch {
      setError("Failed to fetch red packet");
    } finally {
      setLoading(false);
    }
  }, [creator, id]);

  useEffect(() => {
    fetchData();
  }, [fetchData]);

  if (loading) {
    return (
      <div className="flex items-center justify-center py-20">
        <p className="text-muted-foreground">Loading red packet...</p>
      </div>
    );
  }

  if (error || !redPacket) {
    return (
      <div className="flex items-center justify-center py-20">
        <p className="text-destructive">{error || "Red packet not found"}</p>
      </div>
    );
  }

  const isSol = redPacket.tokenType === TOKEN_TYPE_SOL;
  const decimals = isSol ? 9 : 6;
  const nowUnix = Math.floor(Date.now() / 1000);
  const status = getRedPacketStatus(redPacket, nowUnix);

  const alreadyClaimed =
    selectedAccount &&
    redPacket.claimers.some((c) => c === selectedAccount.address);

  const canClaim =
    selectedAccount && status === "active" && !alreadyClaimed;

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold">Claim Red Packet</h1>
        <p className="text-muted-foreground">
          From {creator.slice(0, 8)}...{creator.slice(-4)}
        </p>
      </div>

      <Card>
        <CardHeader>
          <div className="flex items-center justify-between">
            <CardTitle>
              {formatAmount(redPacket.totalAmount, redPacket.tokenType, decimals)}
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
            {redPacket.numClaimed} / {redPacket.numRecipients} claimed
            &middot;{" "}
            {redPacket.splitMode === 0 ? "Even split" : "Random split"}
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          {/* Amounts per slot */}
          <div className="space-y-1">
            {redPacket.amounts.map((amt, i) => (
              <div
                key={i}
                className="flex items-center justify-between text-sm"
              >
                <span>
                  Slot {i + 1}
                  {i < redPacket.claimers.length && (
                    <span className="ml-2 text-muted-foreground">
                      {redPacket.claimers[i]?.slice(0, 6)}...
                    </span>
                  )}
                </span>
                <span>
                  {formatAmount(amt, redPacket.tokenType, decimals)}
                </span>
              </div>
            ))}
          </div>

          {/* Expiry */}
          <p className="text-xs text-muted-foreground">
            Expires:{" "}
            {new Date(Number(redPacket.expiresAt) * 1000).toLocaleString()}
          </p>

          {/* Claim button */}
          {!selectedAccount ? (
            <p className="text-center text-sm text-muted-foreground">
              Connect your wallet to claim
            </p>
          ) : alreadyClaimed ? (
            <p className="text-center text-sm text-green-600">
              You already claimed this red packet!
            </p>
          ) : canClaim ? (
            <ClaimButton
              account={selectedAccount}
              redPacket={redPacket}
              creatorAddress={creatorAddress}
              packetId={packetId}
              onSuccess={fetchData}
            />
          ) : (
            <p className="text-center text-sm text-muted-foreground">
              This red packet is no longer claimable
            </p>
          )}
        </CardContent>
      </Card>
    </div>
  );
}

function ClaimButton({
  account,
  redPacket,
  creatorAddress,
  packetId,
  onSuccess,
}: {
  account: NonNullable<ReturnType<typeof useSelectedWalletAccount>[0]>;
  redPacket: RedPacketAccount;
  creatorAddress: Address;
  packetId: bigint;
  onSuccess: () => void;
}) {
  const signer = useWalletAccountTransactionSendingSigner(
    account,
    "solana:devnet"
  );
  const [isClaiming, setIsClaiming] = useState(false);

  async function handleClaim() {
    setIsClaiming(true);
    try {
      const claimerAddress = address(account.address);
      const isSol = redPacket.tokenType === TOKEN_TYPE_SOL;
      const slotIndex = redPacket.numClaimed;

      const [rpPDA] = await findRedPacketPDA(creatorAddress, packetId);
      const [vaultPDA] = await findVaultPDA(creatorAddress, packetId);

      let claimerTokenAccount: Address | undefined;
      if (!isSol) {
        // Need to get the mint from the red packet data — not stored directly,
        // but we can derive it from the treasury
        // For simplicity, the claimer needs their ATA for the token
        // We can get the mint from the vault's token account data
        const vaultAccount = await fetchEncodedAccount(rpc, vaultPDA);
        if (vaultAccount.exists) {
          const vaultData = new Uint8Array(vaultAccount.data);
          // Token account layout: mint is at offset 0, 32 bytes
          const mintBytes = vaultData.slice(0, 32);
          const mintAddr = address(
            (await import("@solana/kit")).getAddressDecoder().decode(mintBytes)
          );
          claimerTokenAccount = await getAssociatedTokenAddress(
            claimerAddress,
            mintAddr
          );
        }
      }

      const ix = buildClaimInstruction({
        tokenType: redPacket.tokenType,
        slotIndex,
        claimer: claimerAddress,
        claimerTokenAccount,
        redPacket: rpPDA,
        vault: vaultPDA,
      });

      await sendTransaction(signer, [ix]);

      const decimals = isSol ? 9 : 6;
      toast.success(
        `Claimed ${formatAmount(redPacket.amounts[slotIndex], redPacket.tokenType, decimals)}!`
      );
      onSuccess();
    } catch (e: unknown) {
      const msg = e instanceof Error ? e.message : "Claim failed";
      toast.error(msg);
    } finally {
      setIsClaiming(false);
    }
  }

  const decimals = redPacket.tokenType === TOKEN_TYPE_SOL ? 9 : 6;
  const claimAmount = redPacket.amounts[redPacket.numClaimed];

  return (
    <Button
      className="w-full"
      onClick={handleClaim}
      disabled={isClaiming}
    >
      {isClaiming
        ? "Claiming..."
        : `Claim ${claimAmount ? formatAmount(claimAmount, redPacket.tokenType, decimals) : ""}`}
    </Button>
  );
}
