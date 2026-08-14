#!/usr/bin/env python3
"""Local fixture: crawl a Project Gutenberg public-mirror index and save TXT ebooks.

Placeholders (override via env or CLI):
    INDEX_URL   catalog / search / bookshelf HTML page
    OUTPUT_DIR  destination directory for downloaded .txt files
    RATE        max requests per second (float)

Public-domain / CC0 source. Standard library only. Python 3.8+.
"""

from __future__ import annotations

import argparse
import hashlib
import html as html_lib
import os
import re
import sys
import time
import urllib.error
import urllib.parse
import urllib.request
from html.parser import HTMLParser
from pathlib import Path
from typing import Dict, Iterable, List, Optional, Set, Tuple

# --- fixture placeholders ---------------------------------------------------
INDEX_URL = os.environ.get(
    "INDEX_URL",
    "https://www.gutenberg.org/ebooks/search/?sort_order=downloads",
)
OUTPUT_DIR = os.environ.get("OUTPUT_DIR", "./gutenberg_txt")
RATE = float(os.environ.get("RATE", "0.5"))  # req/s; Gutenberg asks for polite delays

USER_AGENT = (
    "GutenbergFixtureCrawler/1.0 (+https://www.gutenberg.org/policy/robot_access.html)"
)
TIMEOUT_SEC = 30
MAX_RETRIES = 4
BACKOFF_BASE = 2.0
MAX_PAGES = 50
CHUNK_SIZE = 64 * 1024

# Book page: /ebooks/1342  (ignore /ebooks/search, /ebooks/bookshelf, etc.)
BOOK_HREF_RE = re.compile(
    r"^/ebooks/(\d+)(?:(?:\.html)?/?|(?:\.txt\.utf-8))$",
    re.IGNORECASE,
)
BOOK_ABS_RE = re.compile(
    r"https?://[^/]+/ebooks/(\d+)(?:(?:\.html)?/?|(?:\.txt\.utf-8))?(?:[?#].*)?$",
    re.IGNORECASE,
)
# Direct text artefacts on mirrors / files trees
TXT_HREF_RE = re.compile(
    r"(?:"
    r"/ebooks/(\d+)\.txt(?:\.utf-8)?"
    r"|/cache/epub/(\d+)/pg\d+\.txt"
    r"|/files/(\d+)/\d+(?:-\d+)?\.txt"
    r"|/(\d+)/(\d+(?:-\d+)?)\.txt"
    r")",
    re.IGNORECASE,
)
NEXT_HINTS = ("next", "next page", ">", ">>", "more")

# Preferred TXT candidates, in order, relative to a book id on the same origin.
TXT_PATH_TEMPLATES = (
    "/ebooks/{id}.txt.utf-8",
    "/cache/epub/{id}/pg{id}.txt",
    "/files/{id}/{id}-0.txt",
    "/files/{id}/{id}-8.txt",
    "/files/{id}/{id}.txt",
)


class LinkParser(HTMLParser):
    """Collect (href, text) pairs and a best-effort pagination 'next' URL."""

    def __init__(self) -> None:
        super().__init__()
        self.links: List[Tuple[str, str]] = []
        self._href: Optional[str] = None
        self._chunks: List[str] = []
        self._in_rel_next = False

    def handle_starttag(self, tag: str, attrs: List[Tuple[str, Optional[str]]]) -> None:
        if tag != "a":
            return
        attr = {k.lower(): (v or "") for k, v in attrs}
        href = attr.get("href", "").strip()
        if not href:
            return
        self._href = href
        self._chunks = []
        rel = attr.get("rel", "").lower()
        self._in_rel_next = "next" in rel.split()

    def handle_data(self, data: str) -> None:
        if self._href is not None:
            self._chunks.append(data)

    def handle_endtag(self, tag: str) -> None:
        if tag != "a" or self._href is None:
            return
        text = html_lib.unescape("".join(self._chunks)).strip()
        self.links.append((self._href, text))
        self._href = None
        self._chunks = []
        self._in_rel_next = False


class RateLimiter:
    def __init__(self, rate: float) -> None:
        if rate <= 0:
            raise ValueError("RATE must be > 0")
        self.min_interval = 1.0 / rate
        self._last = 0.0

    def wait(self) -> None:
        now = time.monotonic()
        gap = self.min_interval - (now - self._last)
        if gap > 0:
            time.sleep(gap)
        self._last = time.monotonic()


def build_opener() -> urllib.request.OpenerDirector:
    opener = urllib.request.build_opener()
    opener.addheaders = [
        ("User-Agent", USER_AGENT),
        ("Accept", "text/html,text/plain;q=0.9,*/*;q=0.1"),
        ("Accept-Language", "en"),
    ]
    return opener


def fetch_bytes(
    opener: urllib.request.OpenerDirector,
    limiter: RateLimiter,
    url: str,
    *,
    retries: int = MAX_RETRIES,
) -> Tuple[bytes, str]:
    """GET url. Returns (body, final_url). Honours RATE and retries 429/5xx."""
    last_err: Optional[BaseException] = None
    for attempt in range(retries):
        limiter.wait()
        req = urllib.request.Request(url, method="GET")
        try:
            with opener.open(req, timeout=TIMEOUT_SEC) as resp:
                ctype = resp.headers.get("Content-Type", "")
                data = resp.read()
                final = resp.geturl()
                if "text/html" in ctype or "text/plain" in ctype or not ctype:
                    return data, final
                return data, final
        except urllib.error.HTTPError as exc:
            last_err = exc
            retryable = exc.code in (408, 425, 429, 500, 502, 503, 504)
            if not retryable or attempt == retries - 1:
                raise
            retry_after = exc.headers.get("Retry-After") if exc.headers else None
            try:
                sleep_s = float(retry_after) if retry_after else BACKOFF_BASE ** (attempt + 1)
            except ValueError:
                sleep_s = BACKOFF_BASE ** (attempt + 1)
            time.sleep(min(sleep_s, 60.0))
        except (urllib.error.URLError, TimeoutError, OSError) as exc:
            last_err = exc
            if attempt == retries - 1:
                raise
            time.sleep(BACKOFF_BASE ** (attempt + 1))
    raise RuntimeError("fetch_bytes exhausted retries") from last_err


def absolutize(base: str, href: str) -> str:
    return urllib.parse.urljoin(base, href)


def book_id_from_href(href: str) -> Optional[str]:
    path = urllib.parse.urlparse(href).path
    m = BOOK_HREF_RE.match(path)
    if m:
        return m.group(1)
    m = BOOK_ABS_RE.match(href)
    if m:
        return m.group(1)
    m = TXT_HREF_RE.search(path)
    if m:
        for g in m.groups():
            if g and g.isdigit():
                return g
    return None


def looks_like_next(href: str, text: str) -> bool:
    t = text.strip().lower()
    if t in NEXT_HINTS or t.startswith("next"):
        return True
    q = urllib.parse.parse_qs(urllib.parse.urlparse(href).query)
    if "start_index" in q or "page" in q:
        return t in NEXT_HINTS or "next" in t
    return False


def parse_index(html: str, page_url: str) -> Tuple[Dict[str, str], Optional[str]]:
    """Return {book_id: title_or_url} and an optional next-page URL."""
    parser = LinkParser()
    parser.feed(html)
    parser.close()

    books: Dict[str, str] = {}
    next_url: Optional[str] = None
    for href, text in parser.links:
        if href.startswith("#") or href.lower().startswith("javascript:"):
            continue
        abs_url = absolutize(page_url, href)
        bid = book_id_from_href(abs_url)
        if bid and bid not in books:
            title = re.sub(r"\s+", " ", text).strip() or "ebook-{0}".format(bid)
            books[bid] = title
        if next_url is None and looks_like_next(href, text):
            next_url = abs_url
        rel_next = href  # LinkParser already recorded rel=next as a normal link
        if next_url is None and "rel=next" in href.lower():
            next_url = abs_url

    # Second pass: rel="next" is not in the href; re-parse start tags via regex
    # for <a rel="next" href="..."> which HTMLParser stored only as a regular link.
    rel_next_re = re.compile(
        r'<a\b[^>]*\brel=["\'][^"\']*\bnext\b[^"\']*["\'][^>]*\bhref=["\']([^"\']+)["\']',
        re.IGNORECASE,
    )
    rel_next_re2 = re.compile(
        r'<a\b[^>]*\bhref=["\']([^"\']+)["\'][^>]*\brel=["\'][^"\']*\bnext\b[^"\']*["\']',
        re.IGNORECASE,
    )
    for rx in (rel_next_re, rel_next_re2):
        m = rx.search(html)
        if m:
            next_url = absolutize(page_url, html_lib.unescape(m.group(1)))
            break

    return books, next_url


def crawl_index(
    opener: urllib.request.OpenerDirector,
    limiter: RateLimiter,
    index_url: str,
    max_pages: int,
) -> Dict[str, str]:
    seen_pages: Set[str] = set()
    books: Dict[str, str] = {}
    url: Optional[str] = index_url
    page_n = 0
    while url and page_n < max_pages:
        canon = urllib.parse.urldefrag(url)[0]
        if canon in seen_pages:
            break
        seen_pages.add(canon)
        page_n += 1
        print("[index] page {0}: {1}".format(page_n, canon), file=sys.stderr)
        body, final = fetch_bytes(opener, limiter, canon)
        page_books, next_url = parse_index(body.decode("utf-8", errors="replace"), final)
        for bid, title in page_books.items():
            books.setdefault(bid, title)
        print("[index]   +{0} books (total {1})".format(len(page_books), len(books)), file=sys.stderr)
        url = next_url
    return books


def origin_of(url: str) -> str:
    parts = urllib.parse.urlsplit(url)
    return urllib.parse.urlunsplit((parts.scheme, parts.netloc, "", "", ""))


def candidate_txt_urls(index_url: str, book_id: str) -> List[str]:
    origin = origin_of(index_url)
    urls = [origin + tmpl.format(id=book_id) for tmpl in TXT_PATH_TEMPLATES]
    # Dedup while preserving order
    out: List[str] = []
    seen: Set[str] = set()
    for u in urls:
        if u not in seen:
            seen.add(u)
            out.append(u)
    return out


def discover_txt_from_book_page(
    opener: urllib.request.OpenerDirector,
    limiter: RateLimiter,
    index_url: str,
    book_id: str,
) -> Optional[str]:
    page = origin_of(index_url) + "/ebooks/{0}".format(book_id)
    try:
        body, final = fetch_bytes(opener, limiter, page)
    except (urllib.error.HTTPError, urllib.error.URLError, TimeoutError, OSError) as exc:
        print("[skip] book page {0}: {1}".format(book_id, exc), file=sys.stderr)
        return None
    html = body.decode("utf-8", errors="replace")
    parser = LinkParser()
    parser.feed(html)
    parser.close()
    scored: List[Tuple[int, str]] = []
    for href, text in parser.links:
        abs_url = absolutize(final, href)
        path = urllib.parse.urlparse(abs_url).path.lower()
        blob = (path + " " + text).lower()
        if not (path.endswith(".txt") or ".txt.utf-8" in path or "plain text" in blob):
            continue
        if book_id not in path and book_id not in abs_url:
            continue
        score = 0
        if "utf-8" in blob or "utf8" in blob:
            score += 3
        if path.endswith(".txt") or path.endswith(".txt.utf-8"):
            score += 2
        if "plain text" in blob:
            score += 1
        scored.append((score, abs_url))
    if not scored:
        return None
    scored.sort(key=lambda x: -x[0])
    return scored[0][1]


def safe_filename(book_id: str, title: str) -> str:
    slug = re.sub(r"[^\w\s-]", "", title, flags=re.UNICODE)
    slug = re.sub(r"[\s-]+", "-", slug).strip("-._")
    slug = slug[:80] or "ebook"
    return "{0}_{1}.txt".format(book_id, slug)


def download_txt(
    opener: urllib.request.OpenerDirector,
    limiter: RateLimiter,
    url: str,
    dest: Path,
) -> bool:
    dest.parent.mkdir(parents=True, exist_ok=True)
    tmp = dest.with_suffix(dest.suffix + ".part")
    last_err: Optional[BaseException] = None
    for attempt in range(MAX_RETRIES):
        limiter.wait()
        req = urllib.request.Request(url, method="GET")
        try:
            with opener.open(req, timeout=TIMEOUT_SEC) as resp:
                ctype = (resp.headers.get("Content-Type") or "").lower()
                if "text/html" in ctype and "text/plain" not in ctype:
                    # Soft 404 / login / error page
                    print("[skip] not text/plain: {0} ({1})".format(url, ctype), file=sys.stderr)
                    return False
                hasher = hashlib.sha256()
                size = 0
                with tmp.open("wb") as fh:
                    while True:
                        chunk = resp.read(CHUNK_SIZE)
                        if not chunk:
                            break
                        fh.write(chunk)
                        hasher.update(chunk)
                        size += len(chunk)
            if size < 64:
                tmp.unlink(missing_ok=True)
                print("[skip] too small ({0} B): {1}".format(size, url), file=sys.stderr)
                return False
            tmp.replace(dest)
            print(
                "[ok] {0}  {1} B  sha256={2}".format(dest.name, size, hasher.hexdigest()[:16]),
                file=sys.stderr,
            )
            return True
        except urllib.error.HTTPError as exc:
            last_err = exc
            if exc.code == 404:
                if tmp.exists():
                    tmp.unlink()
                return False
            if exc.code not in (408, 425, 429, 500, 502, 503, 504) or attempt == MAX_RETRIES - 1:
                if tmp.exists():
                    tmp.unlink()
                raise
            time.sleep(min(BACKOFF_BASE ** (attempt + 1), 60.0))
        except (urllib.error.URLError, TimeoutError, OSError) as exc:
            last_err = exc
            if attempt == MAX_RETRIES - 1:
                if tmp.exists():
                    tmp.unlink()
                raise
            time.sleep(BACKOFF_BASE ** (attempt + 1))
    if tmp.exists():
        tmp.unlink()
    raise RuntimeError("download_txt exhausted retries") from last_err


def fetch_book(
    opener: urllib.request.OpenerDirector,
    limiter: RateLimiter,
    index_url: str,
    book_id: str,
    title: str,
    output_dir: Path,
    seen_ids: Set[str],
) -> bool:
    if book_id in seen_ids:
        return False
    dest = output_dir / safe_filename(book_id, title)
    if dest.exists() and dest.stat().st_size >= 64:
        print("[have] {0}".format(dest.name), file=sys.stderr)
        seen_ids.add(book_id)
        return True

    urls = candidate_txt_urls(index_url, book_id)
    for url in urls:
        try:
            if download_txt(opener, limiter, url, dest):
                seen_ids.add(book_id)
                return True
        except (urllib.error.HTTPError, urllib.error.URLError, TimeoutError, OSError) as exc:
            print("[try] {0} -> {1}".format(url, exc), file=sys.stderr)

    discovered = discover_txt_from_book_page(opener, limiter, index_url, book_id)
    if discovered:
        try:
            if download_txt(opener, limiter, discovered, dest):
                seen_ids.add(book_id)
                return True
        except (urllib.error.HTTPError, urllib.error.URLError, TimeoutError, OSError) as exc:
            print("[try] {0} -> {1}".format(discovered, exc), file=sys.stderr)

    print("[fail] book {0} ({1})".format(book_id, title), file=sys.stderr)
    return False


def parse_args(argv: Optional[Iterable[str]] = None) -> argparse.Namespace:
    p = argparse.ArgumentParser(description="Download public-domain TXT ebooks from a Gutenberg mirror index.")
    p.add_argument("--index-url", default=INDEX_URL, help="INDEX_URL (catalog/search HTML)")
    p.add_argument("--output-dir", default=OUTPUT_DIR, help="OUTPUT_DIR")
    p.add_argument("--rate", type=float, default=RATE, help="RATE requests per second")
    p.add_argument("--max-pages", type=int, default=MAX_PAGES, help="index pagination cap")
    p.add_argument("--max-books", type=int, default=0, help="0 = no cap")
    return p.parse_args(list(argv) if argv is not None else None)


def main(argv: Optional[Iterable[str]] = None) -> int:
    args = parse_args(argv)
    index_url = args.index_url
    output_dir = Path(args.output_dir)
    rate = float(args.rate)
    output_dir.mkdir(parents=True, exist_ok=True)

    opener = build_opener()
    limiter = RateLimiter(rate)

    books = crawl_index(opener, limiter, index_url, max_pages=args.max_pages)
    if not books:
        print("[done] no book links parsed from INDEX_URL", file=sys.stderr)
        return 1

    ids = sorted(books, key=lambda x: int(x))
    if args.max_books > 0:
        ids = ids[: args.max_books]

    seen: Set[str] = set()
    ok = 0
    for bid in ids:
        if fetch_book(opener, limiter, index_url, bid, books[bid], output_dir, seen):
            ok += 1
    print("[done] saved {0}/{1} TXT files under {2}".format(ok, len(ids), output_dir), file=sys.stderr)
    return 0 if ok else 2


if __name__ == "__main__":
    sys.exit(main())
