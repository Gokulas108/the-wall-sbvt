import UserStatsClient from "./UserStatsClient";

export default async function UserStatsPage({
  params,
}: {
  params: Promise<{ user_id: string }>;
}) {
  const { user_id } = await params;
  const userId = parseInt(user_id, 10);

  if (!Number.isFinite(userId)) {
    return (
      <div
        style={{
          minHeight: "100vh",
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          background:
            "linear-gradient(145deg, #1a0f0a, #2a150c 50%, #1a0f0a)",
          color: "#f8c6c1",
        }}
      >
        Invalid user ID.
      </div>
    );
  }

  return <UserStatsClient userId={userId} />;
}
