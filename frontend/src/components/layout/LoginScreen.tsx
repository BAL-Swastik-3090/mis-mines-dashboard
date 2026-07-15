"use client";
import React, { useState } from "react";
import { Lock, User, AlertCircle, Loader2, ShieldCheck, HelpCircle } from "lucide-react";
import api from "@/lib/api";

interface LoginScreenProps {
  onLoginSuccess: () => void;
}

export default function LoginScreen({ onLoginSuccess }: LoginScreenProps) {
  const [empid, setEmpid] = useState("");
  const [password, setPassword] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!empid.trim() || !password) {
      setError("Please fill in all fields.");
      return;
    }

    setLoading(true);
    setError(null);

    try {
      const res = await api.post("/auth/login", {
        empid: empid.trim(),
        password: password,
      });

      if (res.data && res.data.status === "success") {
        localStorage.setItem("auth_token", res.data.token);
        localStorage.setItem("auth_empid", res.data.empid);
        onLoginSuccess();
      } else {
        setError("Invalid response format from server.");
      }
    } catch (err: any) {
      console.error("Login failed:", err);
      const errMsg = err.response?.data?.detail || "Connection failed. Please try again.";
      setError(errMsg);
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="min-h-screen w-screen flex items-center justify-center bg-[#f5f7fb] select-none p-4 relative overflow-hidden">
      {/* Decorative background shapes */}
      <div className="absolute -top-32 -left-32 w-96 h-96 rounded-full bg-navy/5 blur-3xl" />
      <div className="absolute -bottom-32 -right-32 w-96 h-96 rounded-full bg-gold/5 blur-3xl" />

      {/* Main Login Card */}
      <div className="w-full max-w-md bg-white border border-border rounded-xl shadow-lg p-8 relative z-10">
        {/* Brand header */}
        <div className="text-center mb-8">
          <div className="inline-flex h-12 w-12 items-center justify-center rounded-lg bg-navy text-gold shadow-md mb-3 border border-gold/20">
            <ShieldCheck size={26} />
          </div>
          <span className="text-[10px] font-bold uppercase tracking-widest text-txt-muted font-condensed block">
            Balasore Alloys Limited
          </span>
          <h2 className="text-2xl font-black text-navy font-condensed tracking-wide uppercase mt-1">
            Kaliapani Chromite Mines
          </h2>
          <p className="text-[11px] text-txt-light mt-1">
            MIS Portal & Analytics Dashboard Access
          </p>
        </div>

        {error && (
          <div className="mb-5 p-3.5 rounded-lg bg-red-50 border border-red-200 flex items-center gap-2.5 text-[12px] text-[#c62828] font-condensed font-bold">
            <AlertCircle size={15} className="shrink-0" />
            <span>{error}</span>
          </div>
        )}

        <form onSubmit={handleSubmit} className="space-y-4">
          {/* Employee ID */}
          <div>
            <label className="block text-[11px] font-bold uppercase tracking-wider text-txt-secondary font-condensed mb-1.5">
              Employee ID
            </label>
            <div className="relative">
              <div className="absolute inset-y-0 left-0 pl-3 flex items-center pointer-events-none text-txt-light">
                <User size={14} />
              </div>
              <input
                type="text"
                required
                value={empid}
                onChange={(e) => setEmpid(e.target.value)}
                placeholder="Enter Employee ID"
                disabled={loading}
                className="w-full pl-9 pr-3 py-2 border border-border rounded text-[12px] outline-none focus:border-gold font-mono transition-colors bg-bg-light placeholder-txt-light/60 text-txt-primary"
              />
            </div>
          </div>

          {/* Password */}
          <div>
            <label className="block text-[11px] font-bold uppercase tracking-wider text-txt-secondary font-condensed mb-1.5">
              Password
            </label>
            <div className="relative">
              <div className="absolute inset-y-0 left-0 pl-3 flex items-center pointer-events-none text-txt-light">
                <Lock size={14} />
              </div>
              <input
                type="password"
                required
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                placeholder="Enter Password"
                disabled={loading}
                className="w-full pl-9 pr-3 py-2 border border-border rounded text-[12px] outline-none focus:border-gold transition-colors bg-bg-light placeholder-txt-light/60 text-txt-primary"
              />
            </div>
          </div>

          {/* Sign In Button */}
          <button
            type="submit"
            disabled={loading}
            className="w-full flex items-center justify-center gap-2 py-2.5 rounded bg-gold hover:bg-gold-dark text-white font-condensed font-black tracking-widest text-[12px] uppercase shadow transition-all duration-150 active:scale-[0.98] disabled:opacity-70 disabled:pointer-events-none mt-2"
          >
            {loading ? (
              <>
                <Loader2 size={14} className="animate-spin" />
                Signing In...
              </>
            ) : (
              "Sign In"
            )}
          </button>
        </form>

        {/* Footer info */}
        <div className="mt-8 pt-5 border-t border-border-light text-center flex items-center justify-center gap-1.5 text-[10px] text-txt-light font-condensed">
          <HelpCircle size={12} />
          <span>Validated against Intranet login credentials</span>
        </div>
      </div>
    </div>
  );
}
