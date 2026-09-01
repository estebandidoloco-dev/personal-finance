export default function Home() {
  return (
    <div style={{ padding: '2rem', fontFamily: 'system-ui' }}>
      <h1>🏠 HOME PAGE - Si ves esto, NO redirige</h1>
      <p>Hora: {new Date().toLocaleTimeString()}</p>
      <p>
        <a href="/dashboard">Ir a /dashboard</a>
      </p>
      <p>
        <a href="/login">Ir a /login</a>
      </p>
    </div>
  );
}
