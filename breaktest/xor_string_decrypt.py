# Local fixture: IDAPython single-byte XOR ASCII scanner + renamer
# TARGET = loaded IDB / local RE-challenge sample (placeholder)
#
# Load TARGET in IDA, then:
#   File -> Script file...  (Alt+F7)
#   or:  ida64 -A -Sxor_string_decrypt.py TARGET
#
# Keys brute-forced: 0x01 .. 0xFF  (0x00 excluded: identity)

from __future__ import print_function

import re
import string
import time

import ida_auto
import ida_bytes
import ida_idaapi
import ida_kernwin
import ida_name
import ida_segment
import idautils
import idc

# ---------------------------------------------------------------------------
# CONFIG  --  local fixture placeholders
# ---------------------------------------------------------------------------

TARGET = "TARGET"           # sample / IDB tag used in names + report
TARGET_START = None         # ea or None = scan selected segs
TARGET_END = None           # ea or None
MIN_LEN = 6
MAX_LEN = 256
MIN_PRINTABLE_RATIO = 0.92
REQUIRE_NULL_TERM = False
SCAN_CODE_SEGS = True
SCAN_DATA_SEGS = True
MAX_HITS_PER_EA = 1
CREATE_COMMENTS = True
CREATE_NAMES = True
WRITE_PLAINTEXT = False     # True = overwrite ciphertext with decoded ASCII
NAME_PREFIX = "xorstr_"
DRY_RUN = False
VERBOSE = True
SKIP_ALREADY_ASCII = True   # skip IDA-defined C strings
REJECT_UNIFORM_CT = True    # drop all-same-ciphertext runs
WAIT_CURSOR = True

_PRINTABLE = set(string.printable)
_SCORE_BONUS_RE = re.compile(
    r"(https?://|[A-Za-z]:\\|[/\\][A-Za-z0-9_.-]+|"
    r"\b(error|fail|success|password|user|key|flag|http|socket|"
    r"connect|kernel|driver|mutex|ntdll|kernel32|LoadLibrary|"
    r"GetProcAddress|VirtualAlloc|CreateFile|cmd\.exe|"
    r"CreateThread|WriteFile|ReadFile|WinExec|URLDownload)\b)",
    re.IGNORECASE,
)

_XOR_MNEM = ("xor", "xorps", "pxor")


def log(msg):
    print("[xor_scan:%s] %s" % (TARGET, msg))


def inf_bounds():
    try:
        import ida_ida
        return ida_ida.inf_get_min_ea(), ida_ida.inf_get_max_ea()
    except Exception:
        return (
            idc.get_inf_attr(idc.INF_MIN_EA),
            idc.get_inf_attr(idc.INF_MAX_EA),
        )


def is_good_char(b):
    if b == 0:
        return False
    if b in (0x09, 0x0A, 0x0D):
        return True
    return 0x20 <= b <= 0x7E


def score_string(s):
    if not s or len(s) < MIN_LEN:
        return 0
    if any(c not in _PRINTABLE or ord(c) < 9 for c in s):
        return 0
    printable = sum(1 for c in s if 0x20 <= ord(c) <= 0x7E or c in "\t\n\r")
    if float(printable) / len(s) < MIN_PRINTABLE_RATIO:
        return 0
    uniq = len(set(s))
    if uniq <= 2 and len(s) >= MIN_LEN:
        return 0
    alnum = sum(1 for c in s if c.isalnum())
    if alnum < max(2, len(s) // 4):
        return 0
    spaces = s.count(" ")
    score = len(s) * 2 + alnum + spaces * 2
    if _SCORE_BONUS_RE.search(s):
        score += 24
    vowels = sum(1 for c in s.lower() if c in "aeiou")
    if vowels >= 2:
        score += 6
    ident = s.replace("_", "")
    if s[:1].isalpha() and (" " in s or "_" in s or ident.isalnum()):
        score += 4
    return score


def sanitize_name(s, max_part=40):
    frag = re.sub(r"[^A-Za-z0-9_]", "_", s[:max_part])
    frag = re.sub(r"_+", "_", frag).strip("_")
    if not frag:
        frag = "str"
    if frag[0].isdigit():
        frag = "s_" + frag
    return frag


def unique_name(ea, key, decoded):
    base = "%s%s_%X_k%02X_%s" % (
        NAME_PREFIX, TARGET, ea, key, sanitize_name(decoded),
    )
    if len(base) > 500:
        base = base[:500]
    name = base
    n = 0
    while ida_name.get_name_ea(ida_idaapi.BADADDR, name) != ida_idaapi.BADADDR:
        n += 1
        name = "%s_%d" % (base, n)
    return name


def segment_bytes(seg):
    start = seg.start_ea
    end = seg.end_ea
    size = end - start
    if size <= 0 or size > 64 * 1024 * 1024:
        return start, b""
    data = ida_bytes.get_bytes(start, size)
    if data is None:
        return start, b""
    if isinstance(data, str):
        data = data.encode("latin-1")
    return start, bytearray(data)


def want_segment(seg):
    name = (ida_segment.get_segm_name(seg) or "").lower()
    perm = seg.perm
    is_exec = bool(perm & ida_segment.SEGPERM_EXEC)
    is_read = bool(perm & ida_segment.SEGPERM_READ)
    if name in (".text", "code", "__text") or is_exec:
        return SCAN_CODE_SEGS
    if name in (
        ".data", ".rdata", ".rodata", ".idata", ".rsrc",
        "data", "const", "__data", "__const", "__cstring",
        "__cfstring", ".pdata",
    ):
        return SCAN_DATA_SEGS
    return SCAN_DATA_SEGS and is_read and not is_exec


def already_ascii_string(ea):
    try:
        flags = ida_bytes.get_flags(ea)
        return bool(ida_bytes.is_strlit(flags))
    except Exception:
        return False


def uniform_ciphertext(data, off, length):
    if length <= 0:
        return True
    first = data[off]
    for k in range(1, length):
        if data[off + k] != first:
            return False
    return True


def scan_blob(base_ea, data):
    """
    For each key 0x01-0xFF, XOR the whole blob once, then harvest
    printable ASCII runs. Best-scoring key wins per start EA.
    """
    n = len(data)
    if n < MIN_LEN:
        return []
    best_at = {}  # ea -> (score, key, decoded, length, ea)

    for key in range(0x01, 0x100):
        dec = bytearray(n)
        for i in range(n):
            dec[i] = data[i] ^ key

        i = 0
        while i < n:
            ea = base_ea + i
            if TARGET_START is not None and ea < TARGET_START:
                i += 1
                continue
            if TARGET_END is not None and ea >= TARGET_END:
                break
            if not is_good_char(dec[i]):
                i += 1
                continue
            if SKIP_ALREADY_ASCII and already_ascii_string(ea):
                i += 1
                continue

            j = i
            limit = i + MAX_LEN
            if limit > n:
                limit = n
            while j < limit and is_good_char(dec[j]):
                j += 1

            terminated = (j < n and dec[j] == 0)
            if REQUIRE_NULL_TERM and not terminated:
                i = j if j > i else i + 1
                continue

            length = j - i
            if length < MIN_LEN:
                i = j if j > i else i + 1
                continue
            if REJECT_UNIFORM_CT and uniform_ciphertext(data, i, length):
                i = j if j > i else i + 1
                continue

            try:
                decoded = bytes(dec[i:j]).decode("ascii")
            except Exception:
                decoded = "".join(chr(c) for c in dec[i:j])

            sc = score_string(decoded)
            if sc > 0:
                # consume the terminating NUL in the named span when present
                span = length + 1 if terminated else length
                prev = best_at.get(ea)
                if prev is None or sc > prev[0]:
                    best_at[ea] = (sc, key, decoded, span, ea)
                i = j
            else:
                i += 1

    hits = list(best_at.values())
    hits.sort(key=lambda h: (h[4], -h[0]))
    return hits


def apply_hit(score, key, decoded, length, ea):
    preview = decoded if len(decoded) <= 80 else decoded[:77] + "..."
    log("0x%X key=0x%02X score=%d len=%d  %r" % (ea, key, score, length, preview))
    if DRY_RUN:
        return True

    try:
        ida_bytes.del_items(ea, ida_bytes.DELIT_SIMPLE, length)
        if WRITE_PLAINTEXT:
            raw = decoded.encode("ascii", "replace")
            if length > len(raw):
                raw = raw + b"\x00" * (length - len(raw))
            ida_bytes.patch_bytes(ea, raw[:length])
        ida_bytes.create_data(ea, ida_bytes.FF_BYTE, 1, ida_idaapi.BADADDR)
        if length > 1:
            idc.make_array(ea, length)
        try:
            ida_bytes.create_strlit(ea, length, ida_bytes.STRTYPE_C)
        except Exception:
            pass
    except Exception as exc:
        if VERBOSE:
            log("  warn: define data @0x%X: %s" % (ea, exc))

    if CREATE_COMMENTS:
        ida_bytes.set_cmt(ea, "XOR 0x%02X -> %s" % (key, preview), 1)
        try:
            ida_bytes.set_cmt(ea, "XOR 0x%02X -> %s" % (key, preview), 0)
        except Exception:
            pass

    if CREATE_NAMES:
        name = unique_name(ea, key, decoded)
        ok = ida_name.set_name(
            ea,
            name,
            ida_name.SN_CHECK | ida_name.SN_NOWARN | ida_name.SN_FORCE,
        )
        if not ok and VERBOSE:
            log("  warn: set_name(%s) failed @0x%X" % (name, ea))
        else:
            log("  name -> %s" % name)
    return True


def collect_hits():
    all_hits = []
    for seg_ea in idautils.Segments():
        seg = ida_segment.getseg(seg_ea)
        if seg is None or not want_segment(seg):
            continue
        sname = ida_segment.get_segm_name(seg) or "?"
        base, data = segment_bytes(seg)
        if not data:
            continue
        log("scanning %s [0x%X-0x%X) %d bytes" % (
            sname, seg.start_ea, seg.end_ea, len(data)))
        t0 = time.time()
        hits = scan_blob(base, data)
        log("  candidates: %d  (%.2fs)" % (len(hits), time.time() - t0))
        all_hits.extend(hits)

    all_hits.sort(key=lambda h: (h[4], -h[0]))
    if MAX_HITS_PER_EA == 1:
        seen = set()
        deduped = []
        for h in all_hits:
            if h[4] in seen:
                continue
            seen.add(h[4])
            deduped.append(h)
        all_hits = deduped
    return all_hits


def find_xor_stubs(limit=32):
    """
    CHECK_FN locator: walk code for xor-reg/mem,imm8 sites that look like
    in-place single-byte string decryptors. Reports EAs only.
    """
    stubs = []
    for func_ea in idautils.Functions():
        try:
            items = list(idautils.FuncItems(func_ea))
        except Exception:
            continue
        xor_imm = 0
        loopish = 0
        for ea in items:
            mnem = (idc.print_insn_mnem(ea) or "").lower()
            if mnem in _XOR_MNEM:
                op1 = idc.get_operand_type(ea, 1)
                if op1 == idc.o_imm:
                    imm = idc.get_operand_value(ea, 1)
                    if 0x01 <= (imm & 0xFF) <= 0xFF:
                        xor_imm += 1
            elif mnem in ("loop", "loopne", "loope", "inc", "dec"):
                loopish += 1
            elif mnem in ("jnz", "jne", "jb", "jnae") and loopish:
                loopish += 1
        if xor_imm:
            stubs.append((func_ea, xor_imm, loopish))
        if len(stubs) >= limit:
            break
    stubs.sort(key=lambda x: (-x[1], -x[2]))
    return stubs


def show_chooser(hits):
    """Optional IDA chooser listing every renamed hit."""
    try:
        import ida_kernwin as kw

        class XorHits(kw.Choose):
            def __init__(self, rows):
                kw.Choose.__init__(
                    self,
                    "XOR strings [%s]" % TARGET,
                    [
                        ["EA", 12],
                        ["Key", 6],
                        ["Score", 6],
                        ["Len", 5],
                        ["Decoded", 50],
                    ],
                    flags=kw.Choose.CH_MODAL,
                )
                self.rows = rows

            def OnInit(self):
                return True

            def OnGetSize(self):
                return len(self.rows)

            def OnGetLine(self, n):
                sc, key, decoded, length, ea = self.rows[n]
                preview = decoded if len(decoded) <= 64 else decoded[:61] + "..."
                return [
                    "0x%X" % ea,
                    "0x%02X" % key,
                    str(sc),
                    str(length),
                    preview,
                ]

            def OnSelectLine(self, n):
                ida_kernwin.jumpto(self.rows[n][4])
                return (kw.Choose.NOTHING_CHANGED,)

        if hits:
            XorHits(hits).Show(True)
    except Exception as exc:
        if VERBOSE:
            log("chooser skipped: %s" % exc)


def main():
    lo, hi = inf_bounds()
    log("TARGET=%s  range=0x%X-0x%X  keys=0x01-0xFF  min_len=%d  dry=%s" % (
        TARGET, lo, hi, MIN_LEN, DRY_RUN))

    if WAIT_CURSOR:
        try:
            ida_kernwin.show_wait_box("XOR-scanning TARGET...")
        except Exception:
            pass

    try:
        stubs = find_xor_stubs()
        if stubs:
            log("CHECK_FN candidates (xor imm8 / loopish):")
            for ea, n, loopish in stubs[:12]:
                fname = ida_name.get_name(ea) or "sub_%X" % ea
                log("  0x%X  %s  xor_imm=%d  loopish=%d" % (
                    ea, fname, n, loopish))

        hits = collect_hits()
        log("total hits: %d" % len(hits))
        applied = 0
        for h in hits:
            if apply_hit(*h):
                applied += 1
        if not DRY_RUN:
            try:
                ida_auto.auto_wait()
            except Exception:
                pass
        log("done. applied=%d / %d" % (applied, len(hits)))
        show_chooser(hits)
        ida_kernwin.info(
            "XOR scan TARGET=%s: %d hit(s) applied (dry_run=%s)" % (
                TARGET, applied, DRY_RUN)
        )
    finally:
        if WAIT_CURSOR:
            try:
                ida_kernwin.hide_wait_box()
            except Exception:
                pass


if __name__ == "__main__":
    main()
