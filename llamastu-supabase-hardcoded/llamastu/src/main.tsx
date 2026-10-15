import React from "react"
import ReactDOM from "react-dom/client"
import App from "./App"
import { registerServiceWorker } from "./lib/push"
import "./index.css"

const container = document.getElementById("root")
if (!container) {
  throw new Error("Root element #root was not found in index.html.")
}

ReactDOM.createRoot(container).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>,
)

// Registered after paint so it never delays first render. The worker provides
// the offline app shell and the Web Push notification transport; the app works
// fully without it, so a failure here is not surfaced to the learner.
window.addEventListener("load", () => {
  void registerServiceWorker()
})
