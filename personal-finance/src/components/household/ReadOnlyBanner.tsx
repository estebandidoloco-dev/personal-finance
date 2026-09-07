export function ReadOnlyBanner() {
  return (
    <div
      role="status"
      className="border-warning bg-warning-soft text-warning rounded-xl border p-4 text-sm"
    >
      <strong>Este espacio está cerrado y es de solo lectura.</strong> Puedes consultar su
      información, pero ya no modificarla.
    </div>
  );
}
