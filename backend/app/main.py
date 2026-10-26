"""Point d'entrée FastAPI de SUNU FX SALES RADAR."""
from __future__ import annotations

from fastapi import FastAPI, Request
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import FileResponse, JSONResponse

from .config import get_settings
from .db import init_engine
from .routers import activite, admin, auth, entreprises, exports, pilotage


def create_app(database_url: str | None = None) -> FastAPI:
    settings = get_settings()
    init_engine(database_url)
    app = FastAPI(title="SUNU FX SALES RADAR", version="1.0.0", docs_url="/api/docs", openapi_url="/api/openapi.json",
                  redoc_url=None)
    if settings.allowed_origins:
        app.add_middleware(CORSMiddleware, allow_origins=settings.allowed_origins, allow_credentials=True,
                           allow_methods=["*"], allow_headers=["*"])

    @app.middleware("http")
    async def entetes_securite(request: Request, call_next):
        response = await call_next(request)
        response.headers.setdefault("X-Content-Type-Options", "nosniff")
        response.headers.setdefault("X-Frame-Options", "DENY")
        response.headers.setdefault("Referrer-Policy", "same-origin")
        response.headers.setdefault(
            "Content-Security-Policy",
            "default-src 'self'; img-src 'self' data: blob:; style-src 'self' 'unsafe-inline'; "
            "script-src 'self'; frame-src 'self'; object-src 'self'; connect-src 'self'")
        if request.url.path.startswith("/api/"):
            response.headers.setdefault("Cache-Control", "no-store")
        return response

    for r in (auth, entreprises, activite, pilotage, admin, exports):
        app.include_router(r.router)

    @app.get("/api/sante")
    def sante() -> dict:
        return {"statut": "ok", "cle_ephemere": settings.secret_key_is_ephemeral}

    dist = settings.frontend_dist
    if dist and dist.is_dir():
        racine = dist.resolve()

        @app.get("/{chemin:path}", include_in_schema=False)
        def spa(chemin: str):
            if chemin.startswith("api/"):
                return JSONResponse({"detail": "Introuvable"}, status_code=404)
            cible = (racine / chemin).resolve()
            if chemin and cible.is_file() and racine in cible.parents:
                return FileResponse(cible)
            return FileResponse(racine / "index.html")

    return app


# Lancement : uvicorn app.main:create_app --factory
