"use client";

import React from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { sound } from "@/lib/audio";

interface NavItem {
  path: string;
  label: string;
  icon: string;
  hasLock?: boolean;
  activeMatch: (pathname: string) => boolean;
}

const NAV_ITEMS: NavItem[] = [
  {
    path: "/",
    label: "Mando",
    icon: "sports_esports",
    activeMatch: (p) => p === "/" || p === "/team",
  },
  {
    path: "/grid",
    label: "Red",
    icon: "grid_view",
    activeMatch: (p) => p === "/grid",
  },
  {
    path: "/rules",
    label: "Reglas",
    icon: "menu_book",
    activeMatch: (p) => p === "/rules",
  },
  {
    path: "/host",
    label: "Anfitrión",
    icon: "videocam",
    hasLock: true,
    activeMatch: (p) => p === "/host",
  },
  {
    path: "/crt",
    label: "CRT",
    icon: "tune",
    activeMatch: (p) => p === "/crt",
  },
];

export function BottomNav() {
  const pathname = usePathname();

  return (
    <nav className="fixed bottom-0 left-0 right-0 z-50 pb-safe bg-surface/90 backdrop-blur-xl border-t border-surface-container-high shadow-2xl">
      <div className="flex justify-around items-center h-16 max-w-lg mx-auto px-2">
        {NAV_ITEMS.map((item) => {
          const isActive = item.activeMatch(pathname);
          return (
            <Link
              key={item.path}
              href={item.path}
              onClick={() => sound.playRelayClick(true)}
              className={`flex flex-col items-center justify-center gap-1 w-16 h-14 rounded-lg transition-all active:scale-90 select-none ${
                isActive
                  ? "text-primary font-bold shadow-[0_0_12px_rgba(43,240,117,0.25)] bg-surface-container-high/60 border border-primary/40"
                  : "text-on-surface-variant hover:text-on-surface hover:bg-surface-container/50"
              }`}
            >
              <div className="relative flex items-center justify-center">
                <span className="material-symbols-outlined text-[22px]">{item.icon}</span>
                {item.hasLock && (
                  <span className="absolute -top-1 -right-2 text-[10px] text-warning-amber material-symbols-outlined">
                    lock
                  </span>
                )}
              </div>
              <span className="font-data text-[10px] uppercase tracking-wider">{item.label}</span>
            </Link>
          );
        })}
      </div>
    </nav>
  );
}
