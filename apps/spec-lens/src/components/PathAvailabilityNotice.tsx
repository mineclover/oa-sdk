export function PathAvailabilityNotice({ message }: { message: string }) {
  return (
    <div
      role="status"
      data-path-provenance-status="unavailable"
      style={{ padding: 32, color: 'var(--text-muted)', textAlign: 'center' }}
    >
      {message}
    </div>
  )
}
