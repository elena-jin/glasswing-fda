# Test Flight — frontend (Quality & Product Console)

Static single-page app generated in OpenDesign with the **PatternFly** design system.

- `index.html` — self-contained (inline CSS/JS, Red Hat fonts via Google Fonts).
- Deployed on **Vercel** as a static site (Root Directory = `web`).
- Data: **Supabase**; assistant calls: the backend in `assistant/`.

## Local preview
```bash
python3 -m http.server 5173 --directory web
# open http://127.0.0.1:5173
```
