"""AI Answer Check: a local web app for selective reliance on AI answers.

    python app.py              then open http://localhost:8000
    python app.py --port 8001

Runs without an API key (scripted scenarios, cached or hand-labelled claims). Set OPENAI_API_KEY to
use GPT live. Only the Python standard library is used.
"""
import json, os, re, sys, time
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer

import checker, kb, llm, pipeline

HERE = os.path.dirname(os.path.abspath(__file__))
STATIC = os.path.join(HERE, "static")
LOGS = os.path.join(HERE, "logs")
SCENARIOS = json.load(open(os.path.join(HERE, "data", "scenarios.json"), encoding="utf-8"))
HANDBOOK = checker.load_handbook()
TYPES = {".html": "text/html; charset=utf-8", ".js": "text/javascript; charset=utf-8",
         ".css": "text/css; charset=utf-8", ".svg": "image/svg+xml"}


class Handler(BaseHTTPRequestHandler):
    def _send(self, code, body, ctype="application/json; charset=utf-8"):
        if not isinstance(body, bytes):
            body = json.dumps(body, ensure_ascii=False).encode("utf-8")
        self.send_response(code)
        self.send_header("Content-Type", ctype)
        self.send_header("Content-Length", str(len(body)))
        self.send_header("Cache-Control", "no-store")
        self.end_headers()
        self.wfile.write(body)

    def do_GET(self):
        path = self.path.split("?")[0]
        if path == "/api/scenarios":
            return self._send(200, [{"id": s["id"], "question": s["question"]} for s in SCENARIOS])
        if path == "/api/status":
            return self._send(200, {"live": llm.live(), "model": llm.MODEL if llm.live() else None})
        if path == "/api/handbook":
            return self._send(200, HANDBOOK)
        if path == "/api/kb":
            return self._send(200, {"documents": kb.list_documents(), "live": llm.live()})
        if path == "/api/kb/handbook":
            return self._send(200, kb.as_handbook())
        preview = re.fullmatch(r"/api/kb/documents/([0-9]+)/preview", path)
        if preview:
            try:
                document = kb.preview_document(preview[1])
            except FileNotFoundError:
                return self._send(404, {"error": "The original file is missing. Upload it again to preview it."})
            except Exception:
                return self._send(422, {"error": "Could not read the document for preview."})
            if document is None:
                return self._send(404, {"error": "Document not found."})
            return self._send(200, document)
        if path == "/api/review":
            return self._send(200, kb.load_review())
        name = "index.html" if path in ("/", "") else path.lstrip("/").replace("static/", "", 1)
        full = os.path.normpath(os.path.join(STATIC, name))
        if not full.startswith(STATIC) or not os.path.isfile(full):
            return self._send(404, {"error": "not found"})
        with open(full, "rb") as f:
            self._send(200, f.read(), TYPES.get(os.path.splitext(full)[1], "application/octet-stream"))

    def do_POST(self):
        n = int(self.headers.get("Content-Length", 0))
        try:
            data = json.loads(self.rfile.read(n).decode("utf-8") or "{}")
        except json.JSONDecodeError:
            return self._send(400, {"error": "bad JSON"})
        if self.path == "/api/run":
            sc = next((s for s in SCENARIOS if s["id"] == data.get("scenario_id")), None)
            q = (data.get("question") or "").strip()
            if not sc and not q:
                return self._send(400, {"error": "Choose a scenario or type a question."})
            try:
                if not sc and data.get("source") == "kb":
                    mine = kb.as_handbook()
                    return self._send(200, pipeline.run(question=q, hb=mine, context=kb.relevant(mine, q)))
                return self._send(200, pipeline.run(scenario=sc, question=None if sc else q, hb=HANDBOOK))
            except Exception as e:
                return self._send(200, {"error": "Something went wrong: %s" % e})
        if self.path.startswith("/api/kb/"):
            try:
                op = self.path[len("/api/kb/"):]
                if op == "upload":
                    return self._send(200, {"id": kb.add_document(data.get("name"), data.get("content", ""), data.get("superseded"))})
                doc = int(data.get("id"))
                if op == "delete":
                    kb.delete_document(doc)
                elif op == "reindex":
                    kb.reindex(doc)
                elif op == "superseded":
                    kb.set_superseded(doc, data.get("superseded"))
                else:
                    return self._send(404, {"error": "not found"})
                return self._send(200, {"ok": True})
            except Exception as e:
                return self._send(400, {"error": str(e)})
        if self.path == "/api/review":
            kb.save_review(data)
            return self._send(200, {"ok": True})
        if self.path == "/api/log":
            os.makedirs(LOGS, exist_ok=True)
            data["server_time"] = time.strftime("%Y-%m-%dT%H:%M:%S")
            with open(os.path.join(LOGS, "interaction_log.jsonl"), "a", encoding="utf-8") as f:
                f.write(json.dumps(data, ensure_ascii=False) + "\n")
            return self._send(200, {"ok": True})
        self._send(404, {"error": "not found"})

    def log_message(self, *a):
        pass


if __name__ == "__main__":
    port = int(sys.argv[sys.argv.index("--port") + 1]) if "--port" in sys.argv else 8000
    print("AI Answer Check on http://localhost:%d  (GPT live: %s)" % (port, "yes, " + llm.MODEL if llm.live() else "no key, offline mode"))
    ThreadingHTTPServer(("localhost", port), Handler).serve_forever()
