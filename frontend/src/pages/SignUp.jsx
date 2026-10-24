import { useState } from "react";
import { useNavigate } from "react-router-dom";

const ROLES = [
  { key: "college", label: "College", name: "college user", to: "/college", hint: "Submit applications, upload documents and track progress." },
  { key: "officer", label: "AICTE officer", name: "AICTE officer", to: "/officer", hint: "Review flags with evidence and record the final decision." },
  { key: "admin", label: "Administrator", name: "administrator", to: "/admin", hint: "Manage users, checklists, verification sources and the audit trail." },
];

export default function SignUp() {
  const navigate = useNavigate();
  const [role, setRole] = useState(ROLES[0]);
  return (
<div className="r" style={{minHeight: 820}}><div style={{flex: 1, background: '#0f1a2e', color: '#fff', padding: 64, display: 'flex', flexDirection: 'column'}}><div className="dk"><div className="r" style={{alignItems: 'center', gap: 10, fontWeight: 600}}><svg width={26} height={26} viewBox="0 0 24 24" fill="none" stroke="#1d4ed8" strokeWidth={2} aria-hidden="true"><path d="M12 3l8 3v6c0 5-3.5 8-8 9-4.5-1-8-4-8-9V6z" /><path d="M8.5 12l2.5 2.5 4.5-5" /></svg>Approval Validation Platform</div></div><div style={{margin: 'auto 0'}}><h1 style={{fontSize: 42, lineHeight: '1.15', maxWidth: 520}}>Documents checked with evidence. Decisions made by people.</h1><p style={{color: '#cbd5e1', marginTop: 18, maxWidth: 480, lineHeight: '1.6'}}>Create an account to upload an application once. The platform reads the documents and checks them against rules and records.</p></div><div><p style={{color: '#cbd5e1', fontSize: 13, margin: '10px 0'}}>✓ &nbsp;AI results are advisory. Officers make every final decision.</p><p style={{color: '#cbd5e1', fontSize: 13, margin: '10px 0'}}>✓ &nbsp;Every flag links to the page and region it came from.</p><p style={{color: '#cbd5e1', fontSize: 13, margin: '10px 0'}}>✓ &nbsp;An append-only audit trail records every action.</p></div></div><div style={{flex: 1, background: '#f4f6fa', padding: '64px 90px', display: 'flex', flexDirection: 'column', justifyContent: 'center'}}><h2 style={{fontSize: 26}}>Sign up</h2><p className="t" style={{margin: '6px 0 18px'}}>Choose how you use the platform. What you see depends on your role.</p><p className="k">Role</p><div className="r" style={{margin: '6px 0'}} role="group" aria-label="Role">
  {ROLES.map((r, i) => (
    <button key={r.key} type="button" onClick={() => setRole(r)} className="in"
      style={{textAlign: 'center', cursor: 'pointer', borderRadius: i === 0 ? '8px 0 0 8px' : i === 2 ? '0 8px 8px 0' : 0,
        background: role.key === r.key ? '#e0e7ff' : '#fff', borderColor: role.key === r.key ? '#1d4ed8' : '#94a3b8'}}>
      {r.label}
    </button>
  ))}
</div><p className="t" style={{fontSize: 12}}>{role.hint}</p><label className="t" htmlFor="a" style={{marginTop: 8}}>Full name</label><input id="a" className="in" type="text" placeholder="Your name" /><label className="t" htmlFor="b" style={{marginTop: 8}}>Institution name</label><input id="b" className="in" type="text" placeholder="Institution" /><label className="t" htmlFor="c" style={{marginTop: 8}}>Work email</label><input id="c" className="in" type="text" placeholder="name@institution.edu" /><label className="t" htmlFor="d" style={{marginTop: 8}}>Password</label><input id="d" className="in" type="password" placeholder="Create a password" /><button type="button" className="btn" onClick={() => navigate(role.to)} style={{textAlign: 'center', marginTop: 18, border: 0, cursor: 'pointer'}}>Sign up as {role.name}</button><p className="t" style={{textAlign: 'center', marginTop: 14}}>Already registered? <a href="#">Sign in</a></p><p className="t" style={{fontSize: 12, marginTop: 22, borderTop: '1px solid #e2e8f0', paddingTop: 14}}>Access is role-based and every action is recorded.</p></div></div>

  );
}
