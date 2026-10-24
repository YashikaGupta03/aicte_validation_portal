import { Routes, Route, Link } from "react-router-dom";
import Landing from "./pages/Landing.jsx";
import SignUp from "./pages/SignUp.jsx";
import CollegeDashboard from "./pages/CollegeDashboard.jsx";
import NewApplication from "./pages/NewApplication.jsx";
import OfficerDashboard from "./pages/OfficerDashboard.jsx";
import AdminDashboard from "./pages/AdminDashboard.jsx";

const pages = [
  ["/", "Landing page"],
  ["/signup", "Sign up"],
  ["/college", "College dashboard"],
  ["/new-application", "College: new application"],
  ["/officer", "AICTE officer dashboard"],
  ["/admin", "Administrator dashboard"],
];

// Quick index of every screen (open at #/pages). Remove once real auth routing exists.
function PageIndex() {
  return (
    <div style={{ padding: 48 }}>
      <h1>All pages</h1>
      <ul>
        {pages.map(([to, label]) => (
          <li key={to} style={{ margin: "10px 0" }}>
            <Link to={to}>{label}</Link>
          </li>
        ))}
      </ul>
    </div>
  );
}

export default function App() {
  return (
    <Routes>
      <Route path="/" element={<Landing />} />
      <Route path="/signup" element={<SignUp />} />
      <Route path="/college" element={<CollegeDashboard />} />
      <Route path="/new-application" element={<NewApplication />} />
      <Route path="/officer" element={<OfficerDashboard />} />
      <Route path="/admin" element={<AdminDashboard />} />
      <Route path="/pages" element={<PageIndex />} />
    </Routes>
  );
}
