export function Spinner({ size = 20 }: { size?: number }) {
  return (
    <>
      <style>{`@keyframes spec-lens-spin { to { transform: rotate(360deg); } }`}</style>
      <span
        style={{
          display: 'inline-block',
          width: size,
          height: size,
          border: `2px solid var(--border)`,
          borderTopColor: 'var(--blue)',
          borderRadius: '50%',
          animation: 'spec-lens-spin 0.7s linear infinite',
        }}
      />
    </>
  )
}
