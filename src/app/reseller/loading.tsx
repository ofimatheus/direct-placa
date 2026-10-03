/** Skeleton discreto enquanto as páginas do revendedor carregam. */
export default function ResellerLoading() {
  return (
    <div aria-busy="true" aria-label="Carregando">
      <div className="skeleton h-8 w-56" />
      <div className="skeleton mt-2 h-4 w-80 max-w-full" />
      <div className="mt-8 grid grid-cols-2 gap-3 lg:grid-cols-4">
        {[0, 1, 2, 3].map((i) => (
          <div key={i} className="skeleton h-[104px]" />
        ))}
      </div>
      <div className="mt-6 grid gap-4 lg:grid-cols-[minmax(0,7fr)_minmax(0,3fr)]">
        <div className="skeleton h-80" />
        <div className="skeleton h-80" />
      </div>
    </div>
  );
}
