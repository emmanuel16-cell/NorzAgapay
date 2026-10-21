from pathlib import Path
import math
from reportlab.lib.pagesizes import A3, landscape
from reportlab.pdfgen import canvas
from reportlab.pdfbase.pdfmetrics import stringWidth


ROOT = Path(__file__).resolve().parents[2]
OUTPUT = ROOT / "output" / "pdf" / "NorzAgapay_Web_Only_Diagrams.pdf"
PAGE_W, PAGE_H = landscape(A3)
MARGIN = 44


def wrap_text(text, font, size, max_width):
    words = str(text).split()
    lines = []
    current = ""
    for word in words:
        candidate = word if not current else current + " " + word
        if current and stringWidth(candidate, font, size) > max_width:
            lines.append(current)
            current = word
        else:
            current = candidate
    if current:
        lines.append(current)
    return lines or [""]


def draw_paragraph(c, text, x, y, width, font="Helvetica", size=16, leading=21, color="black", align="left"):
    c.setFillColor(color)
    c.setFont(font, size)
    lines = wrap_text(text, font, size, width)
    for line in lines:
        if align == "center":
            c.drawCentredString(x + width / 2, y, line)
        elif align == "right":
            c.drawRightString(x + width, y, line)
        else:
            c.drawString(x, y, line)
        y -= leading
    return y


def draw_bullets(c, items, x, y, width, size=16, leading=21, gap=11):
    font = "Helvetica"
    c.setFillColor("black")
    c.setFont(font, size)
    for item in items:
        lines = wrap_text(item, font, size, width - 21)
        c.drawString(x, y, "-")
        c.drawString(x + 20, y, lines[0])
        y -= leading
        for line in lines[1:]:
            c.drawString(x + 20, y, line)
            y -= leading
        y -= gap
    return y


def panel(c, x, y, w, h, title, title_size=20, radius=12, line_width=1.8):
    c.setStrokeColor("black")
    c.setFillColor("white")
    c.setLineWidth(line_width)
    c.roundRect(x, y, w, h, radius, stroke=1, fill=1)
    c.setFont("Helvetica-Bold", title_size)
    c.setFillColor("black")
    c.drawCentredString(x + w / 2, y + h - 32, title)
    c.setLineWidth(1.0)
    c.line(x + 15, y + h - 46, x + w - 15, y + h - 46)


def arrow_head(c, x, y, angle, size=9):
    spread = 0.48
    back_x = x - size * math.cos(angle)
    back_y = y - size * math.sin(angle)
    left = (back_x + size * spread * math.sin(angle), back_y - size * spread * math.cos(angle))
    right = (back_x - size * spread * math.sin(angle), back_y + size * spread * math.cos(angle))
    path = c.beginPath()
    path.moveTo(x, y)
    path.lineTo(*left)
    path.lineTo(*right)
    path.close()
    c.setFillColor("black")
    c.drawPath(path, stroke=0, fill=1)


def connector(c, x1, y1, x2, y2, both=False, line_width=1.8):
    c.setStrokeColor("black")
    c.setLineWidth(line_width)
    c.line(x1, y1, x2, y2)
    angle = math.atan2(y2 - y1, x2 - x1)
    arrow_head(c, x2, y2, angle)
    if both:
        arrow_head(c, x1, y1, angle + math.pi)


def page_header(c, number, title, subtitle):
    c.setFillColor("black")
    c.setFont("Helvetica-Bold", 25)
    c.drawString(MARGIN, PAGE_H - 44, "NORZAGAPAY | WEB PLATFORM")
    c.setFont("Helvetica-Bold", 29)
    c.drawString(MARGIN, PAGE_H - 84, f"{number}. {title}")
    c.setFont("Helvetica", 16)
    c.drawString(MARGIN, PAGE_H - 111, subtitle)
    c.setLineWidth(1.4)
    c.line(MARGIN, PAGE_H - 126, PAGE_W - MARGIN, PAGE_H - 126)


def page_footer(c, number):
    c.setLineWidth(0.8)
    c.line(MARGIN, 35, PAGE_W - MARGIN, 35)
    c.setFont("Helvetica", 11)
    c.setFillColor("black")
    c.drawString(MARGIN, 19, "WEB ONLY - mobile applications are outside the scope of these diagrams")
    c.drawRightString(PAGE_W - MARGIN, 19, f"{number} / 3")


def page_ipo(c):
    page_header(c, 1, "Conceptual Framework - Input, Process, Output", "Web incident response flow with feedback into the shared record")
    gap = 25
    col_w = (PAGE_W - 2 * MARGIN - 2 * gap) / 3
    box_y = 205
    box_h = 520
    xs = [MARGIN, MARGIN + col_w + gap, MARGIN + 2 * (col_w + gap)]
    content = [
        ("INPUT", [
            "Public incident reports with location, description and optional evidence.",
            "Resident accounts, report tracking and follow-up updates.",
            "Barangay dispatch, arrival, field assessment and resolution details.",
            "MDRRMO classification, assignment and escalation decisions.",
            "Safety advisories, evacuation center and hotline information.",
        ]),
        ("PROCESS", [
            "Authenticate accounts and enforce role and barangay access.",
            "Validate and save reports, map pins and evidence.",
            "Route incidents to barangay or MDRRMO work queues.",
            "Dispatch responders; record arrival, assessment and resolution.",
            "Send status changes to dashboards through web API and live updates.",
        ]),
        ("OUTPUT", [
            "Resident report receipt, tracking timeline and status updates.",
            "Barangay and MDRRMO queues, reports and live incident maps.",
            "Responder assignment, arrival and field assessment records.",
            "Resolved incident record and downloadable resolution document.",
            "Web safety advisories, evacuation center and hotline information.",
        ]),
    ]
    for x, (title, items) in zip(xs, content):
        panel(c, x, box_y, col_w, box_h, title, title_size=22)
        draw_bullets(c, items, x + 23, box_y + box_h - 78, col_w - 46, size=16.5, leading=22, gap=12)

    feedback_x = MARGIN + 40
    feedback_y = 72
    feedback_w = PAGE_W - 2 * MARGIN - 80
    feedback_h = 88
    c.setStrokeColor("black")
    c.setFillColor("white")
    c.setLineWidth(1.8)
    c.roundRect(feedback_x, feedback_y, feedback_w, feedback_h, 12, stroke=1, fill=1)
    c.setFillColor("black")
    c.setFont("Helvetica-Bold", 18)
    c.drawCentredString(PAGE_W / 2, feedback_y + 58, "FEEDBACK AND CONTINUOUS UPDATE")
    draw_paragraph(c,
        "Resident follow-ups and authorized responder or dispatcher updates refresh the shared record and return to the live web queues.",
        feedback_x + 22, feedback_y + 31, feedback_w - 44, size=15, leading=18, align="center")
    connector(c, xs[0] + col_w / 2, feedback_y + feedback_h, xs[0] + col_w / 2, box_y, both=False)
    connector(c, xs[2] + col_w / 2, box_y, xs[2] + col_w / 2, feedback_y + feedback_h, both=False)
    page_footer(c, 1)
    c.showPage()


def block_panel(c, x, y, w, h, title, items, body_size=15.5, leading=21):
    panel(c, x, y, w, h, title, title_size=18)
    draw_bullets(c, items, x + 16, y + h - 70, w - 32, size=body_size, leading=leading, gap=9)


def page_block(c):
    page_header(c, 2, "Web System Block Diagram", "The browser portal connects users to shared API, live updates, storage and map services")
    y = 385
    h = 315
    positions = [
        (MARGIN, 205, "USERS", [
            "Residents and public visitors",
            "Barangay admins, staff, dispatchers and responders",
            "MDRRMO admins, dispatchers, logistics and responders",
        ]),
        (292, 275, "NORZAGAPAY WEB PORTAL", [
            "Public reporting and report tracking",
            "Resident account, alerts and evacuation information",
            "Barangay workspace, assessment and escalation",
            "MDRRMO command center, dispatch and incident map",
        ]),
        (610, 250, "BACKEND API", [
            "Node.js and Express REST endpoints",
            "Authentication and role or jurisdiction checks",
            "Report routing, assignment, resolution and PDF generation",
            "Socket.IO live status events",
        ]),
        (900, 245, "DATA SERVICES", [
            "Supabase PostgreSQL - accounts, reports and response records",
            "Supabase Storage - evidence and documents",
            "Upstash Redis - live responder location cache",
        ]),
    ]
    for x, w, title, items in positions:
        block_panel(c, x, y, w, h, title, items, body_size=15, leading=20)
    connector(c, 250, y + h / 2, 292, y + h / 2, both=True)
    connector(c, 567, y + h / 2, 610, y + h / 2, both=True)
    connector(c, 860, y + h / 2, 900, y + h / 2, both=True)

    map_x, map_y, map_w, map_h = 292, 202, 275, 112
    c.setStrokeColor("black")
    c.setFillColor("white")
    c.setLineWidth(1.8)
    c.roundRect(map_x, map_y, map_w, map_h, 12, stroke=1, fill=1)
    c.setFillColor("black")
    c.setFont("Helvetica-Bold", 17)
    c.drawCentredString(map_x + map_w / 2, map_y + 77, "BROWSER MAP LAYER")
    c.setFont("Helvetica", 16)
    c.drawCentredString(map_x + map_w / 2, map_y + 48, "Leaflet + OpenStreetMap tiles")
    c.setFont("Helvetica", 12.5)
    c.drawCentredString(map_x + map_w / 2, map_y + 25, "Map display is part of the web portal")
    connector(c, map_x + map_w / 2, y, map_x + map_w / 2, map_y + map_h, both=True)
    page_footer(c, 2)
    c.showPage()


def layer(c, x, y, w, h, title, subtitle=None):
    c.setStrokeColor("black")
    c.setFillColor("white")
    c.setLineWidth(1.8)
    c.roundRect(x, y, w, h, 13, stroke=1, fill=1)
    c.setFillColor("black")
    c.setFont("Helvetica-Bold", 20)
    c.drawCentredString(x + w / 2, y + h - 29, title)
    if subtitle:
        draw_paragraph(c, subtitle, x + 22, y + h - 55, w - 44, size=15.5, leading=19, align="center")


def mini_card(c, x, y, w, h, title, lines, size=14.5, leading=18):
    c.setStrokeColor("black")
    c.setFillColor("white")
    c.setLineWidth(1.4)
    c.roundRect(x, y, w, h, 9, stroke=1, fill=1)
    c.setFillColor("black")
    c.setFont("Helvetica-Bold", 16)
    c.drawCentredString(x + w / 2, y + h - 24, title)
    text_y = y + h - 49
    for line in lines:
        text_y = draw_paragraph(c, line, x + 14, text_y, w - 28, size=size, leading=leading, align="center")


def page_architecture(c):
    page_header(c, 3, "Web System Architecture", "Layered view of the NorzAgapay web client, API, real-time channel and data services")
    x = MARGIN
    w = PAGE_W - 2 * MARGIN

    layer(c, x, 604, w, 96, "CLIENT TIER - NORZAGAPAY WEB PORTAL",
          "React, TypeScript and Vite | Public and resident pages | Barangay operations | MDRRMO command and response | Leaflet map with OpenStreetMap tiles")
    layer(c, x, 451, w, 105, "NETWORK / GATEWAY")
    mini_card(c, x + 24, 457, (w - 72) / 2, 63, "HTTPS REST API", ["Web requests and responses"], size=14.5, leading=17)
    mini_card(c, x + 48 + (w - 72) / 2, 457, (w - 72) / 2, 63, "SOCKET.IO / WEBSOCKET", ["Live incident and responder updates"], size=14.5, leading=17)

    layer(c, x, 260, w, 155, "APPLICATION SERVER - NODE.JS / EXPRESS / TYPESCRIPT")
    card_gap = 18
    inner_x = x + 22
    card_w = (w - 44 - 2 * card_gap) / 3
    mini_card(c, inner_x, 279, card_w, 75, "AUTHENTICATION AND ACCESS", ["Sign-in, role checks and barangay scope"], size=13.8, leading=17)
    mini_card(c, inner_x + card_w + card_gap, 279, card_w, 75, "INCIDENT WORKFLOWS", ["Report, dispatch, assess, escalate and resolve"], size=13.8, leading=17)
    mini_card(c, inner_x + 2 * (card_w + card_gap), 279, card_w, 75, "REAL-TIME AND DOCUMENTS", ["Socket events, media and resolution PDFs"], size=13.8, leading=17)

    layer(c, x, 66, w, 148, "DATA AND SUPPORT SERVICES")
    mini_card(c, inner_x, 85, card_w, 70, "SUPABASE POSTGRESQL", ["Accounts, reports, assignments and status"], size=13.8, leading=17)
    mini_card(c, inner_x + card_w + card_gap, 85, card_w, 70, "SUPABASE STORAGE", ["Incident evidence and uploaded documents"], size=13.8, leading=17)
    mini_card(c, inner_x + 2 * (card_w + card_gap), 85, card_w, 70, "UPSTASH REDIS", ["Short-lived live responder location cache"], size=13.8, leading=17)

    mid_x = PAGE_W / 2
    connector(c, mid_x, 604, mid_x, 556, both=True)
    connector(c, mid_x, 451, mid_x, 415, both=True)
    connector(c, mid_x, 260, mid_x, 214, both=True)
    page_footer(c, 3)
    c.showPage()


def main():
    OUTPUT.parent.mkdir(parents=True, exist_ok=True)
    c = canvas.Canvas(str(OUTPUT), pagesize=(PAGE_W, PAGE_H), pageCompression=1)
    c.setTitle("NorzAgapay Web-Only System Diagrams")
    c.setAuthor("NorzAgapay project documentation")
    page_ipo(c)
    page_block(c)
    page_architecture(c)
    c.save()
    print(OUTPUT)


if __name__ == "__main__":
    main()
