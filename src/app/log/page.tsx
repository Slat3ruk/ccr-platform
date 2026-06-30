import SessionForm from "@/components/SessionForm";

export default function LogPage() {
  return (
    <>
      <div className="topbar">
        <span className="hash">#</span>
        <h1>log-session</h1>
        <span className="sub">One run at a time — drivers share their own data.</span>
      </div>
      <div className="content">
        <SessionForm />
      </div>
    </>
  );
}
