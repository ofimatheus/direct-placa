"use client";

import { useState } from "react";
import { EyeIcon, LockIcon } from "./LoginIcons";

/** Campo de senha com mostrar/ocultar (funcional; nada decorativo). */
export function PasswordInput({ disabled = false }: { disabled?: boolean }) {
  const [visible, setVisible] = useState(false);
  return (
    <div className="relative">
      <LockIcon className="login-field-icon" />
      <input
        id="password"
        name="password"
        type={visible ? "text" : "password"}
        autoComplete="current-password"
        required
        disabled={disabled}
        placeholder="Sua senha"
        className="login-input pr-12"
      />
      <button
        type="button"
        onClick={() => setVisible((v) => !v)}
        aria-label={visible ? "Ocultar senha" : "Mostrar senha"}
        aria-pressed={visible}
        disabled={disabled}
        className="absolute top-1/2 right-2 grid size-9 -translate-y-1/2 place-items-center rounded-md text-[#8fa0bd] transition-colors hover:text-white focus-visible:outline-2 focus-visible:outline-[#38bdf8]"
      >
        <EyeIcon className="size-5" off={visible} />
      </button>
    </div>
  );
}
