import { useSelectedWalletAccount } from "@solana/react";
import type { UiWallet } from "@wallet-standard/react";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";

export function ConnectWallet() {
  const [selectedWalletAccount, setSelectedWalletAccount, wallets] =
    useSelectedWalletAccount();

  function handleSelect(wallet: UiWallet) {
    if (wallet.accounts.length > 0) {
      setSelectedWalletAccount(wallet.accounts[0]);
    }
  }

  function handleDisconnect() {
    setSelectedWalletAccount(undefined);
  }

  if (selectedWalletAccount) {
    return (
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <Button variant="outline" size="sm">
            {selectedWalletAccount.address.slice(0, 4)}...
            {selectedWalletAccount.address.slice(-4)}
          </Button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end">
          <DropdownMenuItem
            onClick={() =>
              navigator.clipboard.writeText(selectedWalletAccount.address)
            }
          >
            Copy Address
          </DropdownMenuItem>
          <DropdownMenuSeparator />
          <DropdownMenuItem onClick={handleDisconnect}>
            Disconnect
          </DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>
    );
  }

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button size="sm">Connect Wallet</Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end">
        {wallets.length === 0 ? (
          <DropdownMenuItem disabled>No wallets found</DropdownMenuItem>
        ) : (
          wallets.map((wallet) => (
            <DropdownMenuItem
              key={wallet.name}
              onClick={() => handleSelect(wallet)}
            >
              {wallet.name}
            </DropdownMenuItem>
          ))
        )}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
