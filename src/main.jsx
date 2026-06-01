import React from "react";
import { createRoot } from "react-dom/client";
import BaselineDashboard from "./BaselineDashboard.jsx";

createRoot(document.getElementById("root")).render(
  <React.StrictMode>
    <BaselineDashboard />
  </React.StrictMode>
);
