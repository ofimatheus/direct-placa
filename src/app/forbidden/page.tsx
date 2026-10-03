import type { Metadata } from "next";
import Link from "next/link";

export const metadata: Metadata = { title: "Acesso restrito" };

export default function ForbiddenPage() {
  return (
    <main className="grid min-h-screen place-items-center px-4">
      <div className="max-w-md">
        <p className="display text-2xl">Acesso restrito ao administrador</p>
        <p className="mt-2 text-ink-soft">
          Sua conta não tem permissão para a área de produção. Se precisar de acesso, fale com o administrador do sistema.
        </p>
        <div className="mt-6 flex gap-3">
          <Link href="/" className="btn">
            Ir para minha área
          </Link>
          <form action="/auth/signout" method="post">
            <button className="btn">Sair</button>
          </form>
        </div>
      </div>
    </main>
  );
}
