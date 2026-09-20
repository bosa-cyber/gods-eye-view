#!/usr/bin/env python3
"""Server-side bridge from God's Eye View to the installed Agent Reach package."""
import json
import subprocess
import sys


def main():
    payload = json.load(sys.stdin)
    action = payload.get("action")

    if action == "web_read":
        from agent_reach.channels.web import WebChannel
        result = WebChannel().read(payload["url"])
        print(json.dumps({
            "ok": True,
            "url": payload["url"],
            "content": result[:30000],
        }, ensure_ascii=False))
        return

    if action == "github_repo":
        repo = payload["repo"].strip().rstrip("/")
        for prefix in ("https://github.com/", "http://github.com/", "github.com/"):
            if repo.startswith(prefix):
                repo = repo[len(prefix):]
                break
        repo = repo.split("/tree/")[0].split("/blob/")[0]
        parts = repo.split("/")
        if len(parts) < 2:
            raise ValueError("repo must be owner/name or a GitHub repository URL")
        proc = subprocess.run(
            ["gh", "repo", "view", parts[0] + "/" + parts[1],
             "--json", "nameWithOwner,description,url"],
            capture_output=True, text=True, timeout=20,
        )
        if proc.returncode:
            raise RuntimeError(proc.stderr.strip() or "gh repo view failed")
        print(json.dumps({"ok": True, **json.loads(proc.stdout)}, ensure_ascii=False))
        return

    if action == "youtube_info":
        proc = subprocess.run(
            ["yt-dlp", "--dump-single-json", "--skip-download",
             "--no-warnings", payload["url"]],
            capture_output=True, text=True, timeout=45,
        )
        if proc.returncode:
            raise RuntimeError(proc.stderr.strip() or "yt-dlp failed")
        data = json.loads(proc.stdout)
        keep = {
            key: data.get(key)
            for key in (
                "id", "title", "channel", "uploader", "upload_date",
                "duration", "description", "webpage_url"
            )
        }
        print(json.dumps({"ok": True, **keep}, ensure_ascii=False))
        return

    raise ValueError("Unsupported Agent Reach action: " + str(action))


if __name__ == "__main__":
    try:
        main()
    except Exception as exc:
        print(json.dumps({"ok": False, "error": str(exc)}, ensure_ascii=False))
        sys.exit(1)
