export function ControlError({ message }: { message: string }) {
  if (!message) return null;
  return (
    <p className="admin-alert admin-alert--error" role="alert">
      {message}
    </p>
  );
}
