"use client";

import React, { useState } from "react";
import { requestOtp, updateProfile, verifyOtp } from "../../lib/api";
import { useStore } from "../../state/StoreContext";
import { Button } from "../ui/Button";
import { Icon } from "../ui/Icon";
import { Modal } from "../ui/Modal";

export const LoginModal: React.FC = () => {
  const { isLoginModalOpen, setIsLoginModalOpen, setUser } = useStore();
  const [stage, setStage] = useState<"phone" | "otp" | "name">("phone");
  const [phone, setPhone] = useState("");
  const [otp, setOtp] = useState("");
  const [name, setName] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const reset = () => {
    setStage("phone");
    setPhone("");
    setOtp("");
    setName("");
    setError(null);
    setLoading(false);
  };

  const handleRequestOtp = async (e: React.FormEvent) => {
    e.preventDefault();
    if (phone.length !== 10) {
      setError("Please enter a valid 10-digit phone number.");
      return;
    }

    setLoading(true);
    setError(null);
    try {
      await requestOtp(`+91${phone}`);
      setLoading(false);
      setStage("otp");
    } catch (err: unknown) {
      setLoading(false);
      setError(err instanceof Error ? err.message : "Failed to send code. Please try again.");
    }
  };

  const handleVerifyOtp = async (e: React.FormEvent) => {
    e.preventDefault();
    if (otp.length < 4) {
      setError("Please enter the verification code.");
      return;
    }

    setLoading(true);
    setError(null);
    try {
      const res = await verifyOtp(`+91${phone}`, otp);
      setLoading(false);
      if (res.isNewUser) {
        setStage("name");
      } else {
        setUser(res.user);
        setIsLoginModalOpen(false);
        reset();
      }
    } catch (err: unknown) {
      setLoading(false);
      setError(err instanceof Error ? err.message : "Invalid code. Please try again.");
    }
  };

  const handleSaveName = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!name.trim()) {
      setError("Please enter your name.");
      return;
    }

    setLoading(true);
    setError(null);
    try {
      const updated = await updateProfile({ name: name.trim() });
      setUser(updated);
      setIsLoginModalOpen(false);
      reset();
    } catch (err: unknown) {
      setLoading(false);
      setError(err instanceof Error ? err.message : "Failed to update profile.");
    }
  };

  return (
    <Modal
      isOpen={isLoginModalOpen}
      onClose={() => {
        setIsLoginModalOpen(false);
        reset();
      }}
      title={
        stage === "phone"
          ? "Sign in to Darjeeling Stores"
          : stage === "otp"
          ? "Verify Phone Number"
          : "What should we call you?"
      }
    >
      {stage === "phone" && (
        <form onSubmit={handleRequestOtp} style={{ display: "flex", flexDirection: "column", gap: 16 }}>
          <p style={{ fontSize: 14, color: "var(--muted)" }}>
            Enter your mobile number to access your cart, addresses, and track orders live.
          </p>

          <div
            style={{
              display: "flex",
              alignItems: "center",
              background: "var(--cream)",
              borderRadius: 14,
              border: "1.5px solid var(--line)",
              padding: "4px 14px",
              gap: 8,
            }}
          >
            <span style={{ fontSize: 15, fontWeight: 700, color: "var(--ink)" }}>+91</span>
            <input
              type="tel"
              maxLength={10}
              placeholder="10-digit mobile number"
              value={phone}
              onChange={(e) => setPhone(e.target.value.replace(/\D/g, ""))}
              style={{
                flex: 1,
                border: "none",
                background: "transparent",
                outline: "none",
                fontSize: 16,
                fontWeight: 600,
                padding: "10px 0",
              }}
              autoFocus
            />
          </div>

          {error && <p style={{ fontSize: 13, color: "var(--red)", fontWeight: 600 }}>{error}</p>}

          <Button variant="primary" type="submit" loading={loading} style={{ width: "100%", marginTop: 4 }}>
            Continue with OTP
          </Button>
        </form>
      )}

      {stage === "otp" && (
        <form onSubmit={handleVerifyOtp} style={{ display: "flex", flexDirection: "column", gap: 16 }}>
          <p style={{ fontSize: 14, color: "var(--muted)" }}>
            We sent a verification code to <strong>+91 {phone}</strong>.
          </p>

          <div
            style={{
              display: "flex",
              alignItems: "center",
              background: "var(--cream)",
              borderRadius: 14,
              border: "1.5px solid var(--line)",
              padding: "4px 14px",
            }}
          >
            <input
              type="text"
              maxLength={6}
              placeholder="Enter 6-digit code"
              value={otp}
              onChange={(e) => setOtp(e.target.value.trim())}
              style={{
                flex: 1,
                border: "none",
                background: "transparent",
                outline: "none",
                fontSize: 20,
                fontWeight: 800,
                letterSpacing: 4,
                textAlign: "center",
                padding: "10px 0",
              }}
              autoFocus
            />
          </div>

          {error && <p style={{ fontSize: 13, color: "var(--red)", fontWeight: 600 }}>{error}</p>}

          <Button variant="primary" type="submit" loading={loading} style={{ width: "100%" }}>
            Verify & Sign in
          </Button>

          <button
            type="button"
            onClick={() => setStage("phone")}
            style={{ fontSize: 13, color: "var(--maroon)", fontWeight: 700, textAlign: "center" }}
          >
            Change phone number
          </button>
        </form>
      )}

      {stage === "name" && (
        <form onSubmit={handleSaveName} style={{ display: "flex", flexDirection: "column", gap: 16 }}>
          <p style={{ fontSize: 14, color: "var(--muted)" }}>
            Welcome to Darjeeling Stores! Please tell us your name so we can address your deliveries.
          </p>

          <input
            type="text"
            placeholder="Your full name"
            value={name}
            onChange={(e) => setName(e.target.value)}
            style={{
              width: "100%",
              background: "var(--cream)",
              borderRadius: 14,
              border: "1.5px solid var(--line)",
              padding: "14px 16px",
              outline: "none",
              fontSize: 15,
              fontWeight: 600,
            }}
            autoFocus
          />

          {error && <p style={{ fontSize: 13, color: "var(--red)", fontWeight: 600 }}>{error}</p>}

          <Button variant="primary" type="submit" loading={loading} style={{ width: "100%" }}>
            Get Started
          </Button>
        </form>
      )}
    </Modal>
  );
};
