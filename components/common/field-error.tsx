export function FieldError({ id, messages }: { id: string; messages?: string[] }) {
  if (!messages?.length) return null;
  return (
    <p id={id} className="text-destructive text-sm" role="alert">
      {messages[0]}
    </p>
  );
}
