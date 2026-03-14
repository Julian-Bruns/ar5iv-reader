import { render } from "preact";
import App from "./App";
import "./styles/app.css";
import { registerAppServiceWorker } from "./lib/serviceWorker";

render(<App />, document.getElementById("app"));

registerAppServiceWorker();
