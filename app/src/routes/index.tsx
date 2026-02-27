import { createFileRoute } from "@tanstack/react-router";
import { useSelectedWalletAccount } from "@solana/react";
import { useWalletAccountTransactionSendingSigner } from "@solana/react";
import { type Address, address } from "@solana/kit";
import { useState } from "react";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";

import {
  TOKEN_TYPE_SOL,
  TOKEN_TYPE_SPL,
  SPLIT_EVEN,
  SPLIT_RANDOM,
  MAX_RECIPIENTS,
  findRedPacketPDA,
  findVaultPDA,
  findTreasuryPDA,
  findTreasuryVaultPDA,
  buildCreateInstruction,
  computeFee,
  generateRandomSplit,
  formatAmount,
  BLINKS_BASE_URL,
} from "@/lib/program";
import { sendTransaction } from "@/lib/transaction";
import { getAssociatedTokenAddress } from "@/lib/ata";

export const Route = createFileRoute("/")({
  component: CreatePage,
});

function CreatePage() {
  const [selectedAccount] = useSelectedWalletAccount();

  if (!selectedAccount) {
    return (
      <div className="space-y-6">
        <h1 className="text-2xl font-bold">Create Red Packet</h1>
        <Card>
          <CardContent className="py-12 text-center text-muted-foreground">
            Connect your wallet to create a red packet.
          </CardContent>
        </Card>
      </div>
    );
  }

  return <CreateForm account={selectedAccount} />;
}

function CreateForm({
  account,
}: {
  account: NonNullable<ReturnType<typeof useSelectedWalletAccount>[0]>;
}) {
  const signer = useWalletAccountTransactionSendingSigner(
    account,
    "solana:devnet"
  );

  const [tokenType, setTokenType] = useState<number>(TOKEN_TYPE_SOL);
  const [mintAddress, setMintAddress] = useState("");
  const [totalAmount, setTotalAmount] = useState("");
  const [numRecipients, setNumRecipients] = useState(3);
  const [splitMode, setSplitMode] = useState<number>(SPLIT_EVEN);
  const [expiryHours, setExpiryHours] = useState(24);
  const [isSending, setIsSending] = useState(false);
  const [claimUrl, setClaimUrl] = useState<string | null>(null);
  const [blinkUrl, setBlinkUrl] = useState<string | null>(null);

  const isSol = tokenType === TOKEN_TYPE_SOL;
  const decimals = isSol ? 9 : 6;

  async function handleCreate() {
    const rawAmount = parseFloat(totalAmount);
    if (!rawAmount || rawAmount <= 0) {
      toast.error("Enter a valid amount");
      return;
    }
    if (!isSol && !mintAddress) {
      toast.error("Enter a mint address for SPL token");
      return;
    }

    setIsSending(true);
    try {
      const creatorAddress = address(account.address);
      const totalLamports = BigInt(Math.round(rawAmount * 10 ** decimals));
      const id = BigInt(Date.now());
      const expiresAt = BigInt(
        Math.floor(Date.now() / 1000) + expiryHours * 3600
      );

      const [rpPDA, rpBump] = await findRedPacketPDA(creatorAddress, id);
      const [vaultPDA, vaultBump] = await findVaultPDA(creatorAddress, id);

      const amounts =
        splitMode === SPLIT_RANDOM
          ? generateRandomSplit(totalLamports, numRecipients)
          : undefined;

      let mint: Address | undefined;
      let treasuryVault: Address | undefined;
      let creatorTokenAccount: Address | undefined;

      const [treasuryPDA] = isSol
        ? await findTreasuryPDA("SOL")
        : await findTreasuryPDA(address(mintAddress));

      if (!isSol) {
        mint = address(mintAddress);
        [treasuryVault] = await findTreasuryVaultPDA(mint);
        creatorTokenAccount = await getAssociatedTokenAddress(
          creatorAddress,
          mint
        );
      }

      const ix = buildCreateInstruction({
        tokenType,
        id,
        totalAmount: totalLamports,
        numRecipients,
        splitMode,
        expiresAt,
        rpBump,
        vaultBump,
        amounts,
        creator: creatorAddress,
        creatorTokenAccount,
        redPacket: rpPDA,
        vault: vaultPDA,
        treasury: treasuryPDA,
        treasuryVault,
        mint,
      });

      await sendTransaction(signer, [ix]);

      const url = `${window.location.origin}/claim/${creatorAddress}/${id}`;
      setClaimUrl(url);
      setBlinkUrl(
        `${BLINKS_BASE_URL}/api/actions/claim?creator=${creatorAddress}&id=${id}`
      );
      toast.success("Red packet created!");
    } catch (e: unknown) {
      const msg = e instanceof Error ? e.message : "Transaction failed";
      toast.error(msg);
    } finally {
      setIsSending(false);
    }
  }

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold">Create Red Packet</h1>
        <p className="text-muted-foreground">
          Send SOL or SPL tokens to multiple recipients
        </p>
      </div>

      <Card>
        <CardHeader>
          <CardTitle>New Red Packet</CardTitle>
          <CardDescription>
            Fee: 0.1% &middot; Max {MAX_RECIPIENTS} recipients
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          {/* Token type */}
          <div className="space-y-2">
            <Label>Token Type</Label>
            <div className="flex gap-2">
              <Button
                variant={isSol ? "default" : "outline"}
                size="sm"
                onClick={() => setTokenType(TOKEN_TYPE_SOL)}
              >
                SOL
              </Button>
              <Button
                variant={!isSol ? "default" : "outline"}
                size="sm"
                onClick={() => setTokenType(TOKEN_TYPE_SPL)}
              >
                SPL Token
              </Button>
            </div>
          </div>

          {/* Mint address for SPL */}
          {!isSol && (
            <div className="space-y-2">
              <Label htmlFor="mint">Mint Address</Label>
              <Input
                id="mint"
                placeholder="Token mint address"
                value={mintAddress}
                onChange={(e) => setMintAddress(e.target.value)}
              />
            </div>
          )}

          {/* Amount */}
          <div className="space-y-2">
            <Label htmlFor="amount">
              Total Amount {isSol ? "(SOL)" : "(tokens)"}
            </Label>
            <Input
              id="amount"
              type="number"
              placeholder="0.0"
              value={totalAmount}
              onChange={(e) => setTotalAmount(e.target.value)}
              min="0"
              step="any"
            />
            {totalAmount && parseFloat(totalAmount) > 0 && (
              <p className="text-xs text-muted-foreground">
                Fee:{" "}
                {formatAmount(
                  computeFee(
                    BigInt(
                      Math.round(parseFloat(totalAmount) * 10 ** decimals)
                    )
                  ),
                  tokenType,
                  decimals
                )}
              </p>
            )}
          </div>

          {/* Recipients */}
          <div className="space-y-2">
            <Label>Recipients: {numRecipients}</Label>
            <Input
              type="range"
              min={1}
              max={MAX_RECIPIENTS}
              value={numRecipients}
              onChange={(e) => setNumRecipients(parseInt(e.target.value))}
            />
          </div>

          {/* Split mode */}
          <div className="space-y-2">
            <Label>Split Mode</Label>
            <div className="flex gap-2">
              <Button
                variant={splitMode === SPLIT_EVEN ? "default" : "outline"}
                size="sm"
                onClick={() => setSplitMode(SPLIT_EVEN)}
              >
                Even
              </Button>
              <Button
                variant={splitMode === SPLIT_RANDOM ? "default" : "outline"}
                size="sm"
                onClick={() => setSplitMode(SPLIT_RANDOM)}
              >
                Random
              </Button>
            </div>
          </div>

          {/* Expiry */}
          <div className="space-y-2">
            <Label htmlFor="expiry">Expires in (hours)</Label>
            <Input
              id="expiry"
              type="number"
              value={expiryHours}
              onChange={(e) => setExpiryHours(parseInt(e.target.value) || 1)}
              min={1}
              max={720}
            />
          </div>

          {/* Submit */}
          <Button
            className="w-full"
            onClick={handleCreate}
            disabled={isSending || !totalAmount}
          >
            {isSending ? "Creating..." : "Create Red Packet"}
          </Button>
        </CardContent>
      </Card>

      {/* Claim URLs */}
      {claimUrl && (
        <Card>
          <CardHeader>
            <CardTitle>Share This Link</CardTitle>
            <CardDescription>
              Recipients can claim by visiting this URL
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="space-y-2">
              <Label className="text-xs text-muted-foreground">
                Website Link
              </Label>
              <code className="block break-all rounded bg-muted p-3 text-sm">
                {claimUrl}
              </code>
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
            </div>
            {blinkUrl && (
              <div className="space-y-2">
                <Label className="text-xs text-muted-foreground">
                  Blink URL (Solana Actions)
                </Label>
                <code className="block break-all rounded bg-muted p-3 text-sm">
                  {blinkUrl}
                </code>
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => {
                    navigator.clipboard.writeText(blinkUrl);
                    toast.success("Blink URL copied!");
                  }}
                >
                  Copy Blink URL
                </Button>
              </div>
            )}
          </CardContent>
        </Card>
      )}
    </div>
  );
}
