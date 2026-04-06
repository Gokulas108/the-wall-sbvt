"use client";

import { useEffect, useState } from "react";

const PAGE_PASSWORD = "16108";
const AUTH_KEY = "kc-admin-db-auth-date";

export function DatabaseAuthWrapper({ children }: { children: React.ReactNode }) {
  const [authChecked, setAuthChecked] = useState(false);
  const [isAuthorized, setIsAuthorized] = useState(false);

  useEffect(() => {
    const today = new Date().toISOString().slice(0, 10);
    const savedDate = localStorage.getItem(AUTH_KEY);
    if (savedDate === today) {
      setIsAuthorized(true);
      setAuthChecked(true);
      return;
    }

    let value = window.prompt("Enter password");
    while (value !== null && value !== PAGE_PASSWORD) {
      value = window.prompt("Incorrect password. Enter password");
    }

    if (value === PAGE_PASSWORD) {
      localStorage.setItem(AUTH_KEY, today);
      setIsAuthorized(true);
    } else {
      setIsAuthorized(false);
    }
    setAuthChecked(true);
  }, []);

  if (!authChecked) {
    return (
      <div className="min-h-screen w-full flex items-center justify-center bg-gray-50 text-gray-900 font-medium">
        <p>Checking access...</p>
      </div>
    );
  }

  if (!isAuthorized) {
    return (
      <div className="min-h-screen w-full flex items-center justify-center bg-gray-50 text-red-600 font-bold">
        <p>Access denied.</p>
      </div>
    );
  }

  return <>{children}</>;
}
