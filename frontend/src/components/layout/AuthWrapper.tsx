"use client";
import React, { useState, useEffect } from "react";
import LoginScreen from "./LoginScreen";
import Header from "./Header";
import MainLayout from "./MainLayout";
import { useAppPage } from "@/contexts/useAppPage";

export default function AuthWrapper({ children }: { children: React.ReactNode }) {
  const [isAuthenticated, setIsAuthenticated] = useState(false);
  const [loading, setLoading] = useState(true);
  const { setPage } = useAppPage();

  useEffect(() => {
    const token = localStorage.getItem("auth_token");
    setIsAuthenticated(!!token);
    setLoading(false);
  }, []);

  const handleLoginSuccess = () => {
    setPage("mis");
    setIsAuthenticated(true);
  };

  if (loading) {
    return (
      <div className="min-h-screen w-screen flex items-center justify-center bg-[#f5f7fb]">
        <div className="w-8 h-8 border-2 border-border border-t-[#c8960c] rounded-full animate-spin" />
      </div>
    );
  }

  if (!isAuthenticated) {
    return <LoginScreen onLoginSuccess={handleLoginSuccess} />;
  }

  return (
    <>
      <Header />
      <MainLayout>{children}</MainLayout>
    </>
  );
}
