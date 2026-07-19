"use client";

import { createContext, useContext, useEffect, useState, type ReactNode } from "react";
import {
  DEFAULT_STAKING_CHAIN,
  STAKING_NETWORKS,
  networkFor,
  type StakingChainId,
  type StakingNetwork,
} from "./networks";

interface NetworkContextValue {
  network: StakingNetwork;
  chainId: StakingChainId;
  setChainId: (id: StakingChainId) => void;
  /// False until the stored preference has been read. Prevents a flash of the
  /// wrong network label, which on a real-money app is not a cosmetic issue.
  ready: boolean;
}

const NetworkContext = createContext<NetworkContextValue | null>(null);
const STORAGE_KEY = "polymad.stakingChainId";

export function NetworkProvider({ children }: { children: ReactNode }) {
  const [chainId, setChainIdState] = useState<StakingChainId>(DEFAULT_STAKING_CHAIN);
  const [ready, setReady] = useState(false);

  useEffect(() => {
    try {
      const stored = Number(window.localStorage.getItem(STORAGE_KEY));
      if (stored && STAKING_NETWORKS[stored as StakingChainId]) {
        setChainIdState(stored as StakingChainId);
      }
    } catch {
      // Private browsing / storage disabled — the default stands.
    }
    setReady(true);
  }, []);

  function setChainId(id: StakingChainId) {
    setChainIdState(id);
    try {
      window.localStorage.setItem(STORAGE_KEY, String(id));
    } catch {
      /* non-fatal */
    }
  }

  return (
    <NetworkContext.Provider value={{ network: networkFor(chainId), chainId, setChainId, ready }}>
      {children}
    </NetworkContext.Provider>
  );
}

export function useNetwork(): NetworkContextValue {
  const ctx = useContext(NetworkContext);
  if (!ctx) throw new Error("useNetwork must be used inside NetworkProvider");
  return ctx;
}
