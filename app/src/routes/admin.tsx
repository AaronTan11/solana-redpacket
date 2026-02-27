import { createFileRoute } from "@tanstack/react-router";
import { useSelectedWalletAccount } from "@solana/react";
import { useWalletAccountTransactionSendingSigner } from "@solana/react";
import { address, fetchEncodedAccount } from "@solana/kit";
import { useCallback, useEffect, useState } from "react";
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
  ADMIN_ADDRESS,
  TOKEN_TYPE_SOL,
  findTreasuryPDA,
  decodeTreasury,
  buildWithdrawFeesInstruction,
  formatAmount,
} from "@/lib/program";
import { sendTransaction } from "@/lib/transaction";
import { rpc } from "@/lib/rpc";

export const Route = createFileRoute("/admin")({
  component: AdminPage,
});

function AdminPage() {
  const [selectedAccount] = useSelectedWalletAccount();

  if (!selectedAccount) {
    return (
      <div className="space-y-6">
        <h1 className="text-2xl font-bold">Admin</h1>
        <Card>
          <CardContent className="py-12 text-center text-muted-foreground">
            Connect your wallet to access admin functions.
          </CardContent>
        </Card>
      </div>
    );
  }

  const isAdmin = selectedAccount.address === ADMIN_ADDRESS;

  if (!isAdmin) {
    return (
      <div className="space-y-6">
        <h1 className="text-2xl font-bold">Admin</h1>
        <Card>
          <CardContent className="py-12 text-center text-muted-foreground">
            Connected wallet is not the admin. Only{" "}
            <code className="text-xs">
              {String(ADMIN_ADDRESS).slice(0, 8)}...
            </code>{" "}
            can access this page.
          </CardContent>
        </Card>
      </div>
    );
  }

  return <AdminPanel account={selectedAccount} />;
}

function AdminPanel({
  account,
}: {
  account: NonNullable<ReturnType<typeof useSelectedWalletAccount>[0]>;
}) {
  const signer = useWalletAccountTransactionSendingSigner(
    account,
    "solana:devnet"
  );

  const [solFees, setSolFees] = useState<bigint | null>(null);
  const [solTreasuryExists, setSolTreasuryExists] = useState(false);
  const [withdrawAmount, setWithdrawAmount] = useState("");
  const [isWithdrawing, setIsWithdrawing] = useState(false);
  const [loading, setLoading] = useState(true);

  const fetchTreasury = useCallback(async () => {
    setLoading(true);
    try {
      // Fetch SOL treasury
      const [solTreasuryPDA] = await findTreasuryPDA("SOL");
      const solAccount = await fetchEncodedAccount(rpc, solTreasuryPDA);
      if (solAccount.exists) {
        const treasury = decodeTreasury(new Uint8Array(solAccount.data));
        setSolFees(treasury.solFeesCollected);
        setSolTreasuryExists(true);
      } else {
        setSolTreasuryExists(false);
        setSolFees(null);
      }
    } catch {
      toast.error("Failed to fetch treasury data");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchTreasury();
  }, [fetchTreasury]);

  async function handleWithdrawSol() {
    setIsWithdrawing(true);
    try {
      const amount =
        withdrawAmount === "" || withdrawAmount === "0"
          ? 0n // 0 = withdraw all
          : BigInt(
              Math.round(parseFloat(withdrawAmount) * 1e9)
            );

      const [treasuryPDA] = await findTreasuryPDA("SOL");
      const adminAddress = address(account.address);

      const ix = buildWithdrawFeesInstruction({
        tokenType: TOKEN_TYPE_SOL,
        amount,
        admin: adminAddress,
        treasury: treasuryPDA,
      });

      await sendTransaction(signer, [ix]);
      toast.success("SOL fees withdrawn!");
      fetchTreasury();
      setWithdrawAmount("");
    } catch (e: unknown) {
      const msg = e instanceof Error ? e.message : "Withdrawal failed";
      toast.error(msg);
    } finally {
      setIsWithdrawing(false);
    }
  }

  return (
    <div className="space-y-6">
      <h1 className="text-2xl font-bold">Admin Panel</h1>

      {loading ? (
        <p className="text-muted-foreground">Loading treasuries...</p>
      ) : (
        <Card>
          <CardHeader>
            <CardTitle>SOL Treasury</CardTitle>
            <CardDescription>
              {solTreasuryExists
                ? `Accumulated fees: ${solFees !== null ? formatAmount(solFees, TOKEN_TYPE_SOL) : "..."}`
                : "Not initialized"}
            </CardDescription>
          </CardHeader>
          {solTreasuryExists && (
            <CardContent className="space-y-4">
              <div className="space-y-2">
                <Label htmlFor="withdraw-sol">
                  Withdraw amount (SOL, leave empty for all)
                </Label>
                <Input
                  id="withdraw-sol"
                  type="number"
                  placeholder="0 = all"
                  value={withdrawAmount}
                  onChange={(e) => setWithdrawAmount(e.target.value)}
                  min="0"
                  step="any"
                />
              </div>
              <Button
                onClick={handleWithdrawSol}
                disabled={isWithdrawing}
              >
                {isWithdrawing ? "Withdrawing..." : "Withdraw SOL Fees"}
              </Button>
            </CardContent>
          )}
        </Card>
      )}
    </div>
  );
}
