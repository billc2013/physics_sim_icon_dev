import { useState, useEffect, useCallback, useRef } from "react";

const SVG_DATA = {"airplane":"<svg xmlns=\"http://www.w3.org/2000/svg\" viewBox=\"0 0 64 64\">\n  <ellipse cx=\"32\" cy=\"32\" rx=\"26\" ry=\"5\" fill=\"#94A3B8\"/>\n  <path d=\"M18 32 L6 20 L6 28 L18 32Z\" fill=\"#64748B\"/>\n  <path d=\"M18 32 L6 44 L6 36 L18 32Z\" fill=\"#64748B\"/>\n  <path d=\"M26 32 L20 18 H28 L34 32Z\" fill=\"#3B82F6\"/>\n  <path d=\"M26 32 L20 46 H28 L34 32Z\" fill=\"#3B82F6\"/>\n  <ellipse cx=\"54\" cy=\"32\" rx=\"4\" ry=\"3\" fill=\"#CBD5E1\"/>\n  <rect x=\"44\" y=\"30\" width=\"10\" height=\"4\" rx=\"1\" fill=\"#60A5FA\" opacity=\"0.5\"/>\n</svg>","arrow":"<svg xmlns=\"http://www.w3.org/2000/svg\" viewBox=\"0 0 64 64\">\n  <line x1=\"6\" y1=\"32\" x2=\"48\" y2=\"32\" stroke=\"#78350F\" stroke-width=\"2.5\"/>\n  <polygon points=\"48,32 56,32 52,26\" fill=\"#6B7280\"/>\n  <polygon points=\"48,32 56,32 52,38\" fill=\"#6B7280\"/>\n  <line x1=\"6\" y1=\"32\" x2=\"10\" y2=\"26\" stroke=\"#DC2626\" stroke-width=\"1.5\"/>\n  <line x1=\"6\" y1=\"32\" x2=\"10\" y2=\"38\" stroke=\"#DC2626\" stroke-width=\"1.5\"/>\n  <line x1=\"8\" y1=\"32\" x2=\"12\" y2=\"26\" stroke=\"#DC2626\" stroke-width=\"1.5\"/>\n  <line x1=\"8\" y1=\"32\" x2=\"12\" y2=\"38\" stroke=\"#DC2626\" stroke-width=\"1.5\"/>\n</svg>","balloon":"<svg xmlns=\"http://www.w3.org/2000/svg\" viewBox=\"0 0 64 64\">\n  <ellipse cx=\"32\" cy=\"24\" rx=\"16\" ry=\"20\" fill=\"#EF4444\"/>\n  <ellipse cx=\"28\" cy=\"18\" rx=\"5\" ry=\"6\" fill=\"#FCA5A5\" opacity=\"0.4\"/>\n  <polygon points=\"28,44 36,44 34,48 30,48\" fill=\"#DC2626\"/>\n  <path d=\"M32 48 Q28 52 34 54 Q30 56 36 58 Q32 60 32 62\" fill=\"none\" stroke=\"#94A3B8\" stroke-width=\"1.5\"/>\n</svg>","barrel":"<svg xmlns=\"http://www.w3.org/2000/svg\" viewBox=\"0 0 64 64\">\n  <ellipse cx=\"32\" cy=\"50\" rx=\"16\" ry=\"5\" fill=\"#78350F\"/>\n  <path d=\"M16 14 Q12 32 16 50 H48 Q52 32 48 14Z\" fill=\"#B45309\"/>\n  <ellipse cx=\"32\" cy=\"14\" rx=\"16\" ry=\"5\" fill=\"#D97706\"/>\n  <line x1=\"14\" y1=\"24\" x2=\"50\" y2=\"24\" stroke=\"#78350F\" stroke-width=\"2\"/>\n  <line x1=\"13\" y1=\"40\" x2=\"51\" y2=\"40\" stroke=\"#78350F\" stroke-width=\"2\"/>\n</svg>","baseball":"<svg xmlns=\"http://www.w3.org/2000/svg\" viewBox=\"0 0 64 64\">\n  <circle cx=\"32\" cy=\"32\" r=\"20\" fill=\"#F5F5F4\"/>\n  <circle cx=\"32\" cy=\"32\" r=\"20\" fill=\"none\" stroke=\"#DC2626\" stroke-width=\"1.5\"/>\n  <path d=\"M22 14 Q18 22 20 32 Q22 42 26 50\" fill=\"none\" stroke=\"#DC2626\" stroke-width=\"1.5\"/>\n  <path d=\"M42 14 Q46 22 44 32 Q42 42 38 50\" fill=\"none\" stroke=\"#DC2626\" stroke-width=\"1.5\"/>\n</svg>","basketball":"<svg xmlns=\"http://www.w3.org/2000/svg\" viewBox=\"0 0 64 64\">\n  <circle cx=\"32\" cy=\"32\" r=\"20\" fill=\"#F97316\"/>\n  <circle cx=\"32\" cy=\"32\" r=\"20\" fill=\"none\" stroke=\"#9A3412\" stroke-width=\"1.5\"/>\n  <line x1=\"12\" y1=\"32\" x2=\"52\" y2=\"32\" stroke=\"#9A3412\" stroke-width=\"1.2\"/>\n  <line x1=\"32\" y1=\"12\" x2=\"32\" y2=\"52\" stroke=\"#9A3412\" stroke-width=\"1.2\"/>\n  <path d=\"M18 16 Q32 28 18 48\" fill=\"none\" stroke=\"#9A3412\" stroke-width=\"1.2\"/>\n  <path d=\"M46 16 Q32 28 46 48\" fill=\"none\" stroke=\"#9A3412\" stroke-width=\"1.2\"/>\n</svg>","bicycle":"<svg xmlns=\"http://www.w3.org/2000/svg\" viewBox=\"0 0 64 64\">\n  <circle cx=\"16\" cy=\"40\" r=\"11\" fill=\"none\" stroke=\"#1E293B\" stroke-width=\"2.5\"/>\n  <circle cx=\"48\" cy=\"40\" r=\"11\" fill=\"none\" stroke=\"#1E293B\" stroke-width=\"2.5\"/>\n  <line x1=\"16\" y1=\"40\" x2=\"30\" y2=\"24\" stroke=\"#EF4444\" stroke-width=\"2.5\"/>\n  <line x1=\"30\" y1=\"24\" x2=\"38\" y2=\"24\" stroke=\"#EF4444\" stroke-width=\"2.5\"/>\n  <line x1=\"38\" y1=\"24\" x2=\"48\" y2=\"40\" stroke=\"#EF4444\" stroke-width=\"2.5\"/>\n  <line x1=\"30\" y1=\"24\" x2=\"48\" y2=\"40\" stroke=\"#EF4444\" stroke-width=\"2.5\"/>\n  <line x1=\"16\" y1=\"40\" x2=\"38\" y2=\"24\" stroke=\"#EF4444\" stroke-width=\"2.5\"/>\n  <line x1=\"26\" y1=\"22\" x2=\"34\" y2=\"16\" stroke=\"#1E293B\" stroke-width=\"2\"/>\n  <circle cx=\"34\" cy=\"15\" r=\"2\" fill=\"#1E293B\"/>\n</svg>","boat":"<svg xmlns=\"http://www.w3.org/2000/svg\" viewBox=\"0 0 64 64\">\n  <path d=\"M6 38 L12 50 H52 L58 38Z\" fill=\"#2563EB\"/>\n  <path d=\"M6 38 H58\" stroke=\"#1D4ED8\" stroke-width=\"2\"/>\n  <rect x=\"30\" y=\"16\" width=\"3\" height=\"22\" fill=\"#78350F\"/>\n  <path d=\"M33 18 L50 32 L33 34Z\" fill=\"#F1F5F9\"/>\n  <path d=\"M52 50 Q56 54 60 50\" fill=\"none\" stroke=\"#60A5FA\" stroke-width=\"2\"/>\n  <path d=\"M4 50 Q8 54 12 50\" fill=\"none\" stroke=\"#60A5FA\" stroke-width=\"2\"/>\n</svg>","bowling_ball":"<svg xmlns=\"http://www.w3.org/2000/svg\" viewBox=\"0 0 64 64\">\n  <circle cx=\"32\" cy=\"32\" r=\"20\" fill=\"#1E293B\"/>\n  <circle cx=\"32\" cy=\"32\" r=\"20\" fill=\"none\" stroke=\"#0F172A\" stroke-width=\"1.5\"/>\n  <circle cx=\"26\" cy=\"24\" r=\"3\" fill=\"#0F172A\"/>\n  <circle cx=\"34\" cy=\"22\" r=\"3\" fill=\"#0F172A\"/>\n  <circle cx=\"30\" cy=\"30\" r=\"3\" fill=\"#0F172A\"/>\n</svg>","box":"<svg xmlns=\"http://www.w3.org/2000/svg\" viewBox=\"0 0 64 64\">\n  <rect x=\"10\" y=\"22\" width=\"44\" height=\"30\" rx=\"2\" fill=\"#A3836A\"/>\n  <polygon points=\"10,22 20,12 54,12 54,22\" fill=\"#C4A882\"/>\n  <line x1=\"32\" y1=\"12\" x2=\"32\" y2=\"22\" stroke=\"#78350F\" stroke-width=\"1.5\"/>\n  <line x1=\"10\" y1=\"22\" x2=\"54\" y2=\"22\" stroke=\"#78350F\" stroke-width=\"2\"/>\n  <rect x=\"28\" y=\"32\" width=\"8\" height=\"6\" rx=\"1\" fill=\"#78350F\" opacity=\"0.5\"/>\n</svg>","bus":"<svg xmlns=\"http://www.w3.org/2000/svg\" viewBox=\"0 0 64 64\">\n  <rect x=\"6\" y=\"14\" width=\"52\" height=\"30\" rx=\"4\" fill=\"#EF4444\"/>\n  <rect x=\"10\" y=\"18\" width=\"10\" height=\"10\" rx=\"1\" fill=\"#FEE2E2\" opacity=\"0.7\"/>\n  <rect x=\"24\" y=\"18\" width=\"10\" height=\"10\" rx=\"1\" fill=\"#FEE2E2\" opacity=\"0.7\"/>\n  <rect x=\"38\" y=\"18\" width=\"10\" height=\"10\" rx=\"1\" fill=\"#FEE2E2\" opacity=\"0.7\"/>\n  <rect x=\"6\" y=\"34\" width=\"52\" height=\"4\" fill=\"#DC2626\"/>\n  <circle cx=\"16\" cy=\"48\" r=\"5\" fill=\"#1E293B\"/>\n  <circle cx=\"48\" cy=\"48\" r=\"5\" fill=\"#1E293B\"/>\n  <circle cx=\"16\" cy=\"48\" r=\"2\" fill=\"#94A3B8\"/>\n  <circle cx=\"48\" cy=\"48\" r=\"2\" fill=\"#94A3B8\"/>\n</svg>","cannonball":"<svg xmlns=\"http://www.w3.org/2000/svg\" viewBox=\"0 0 64 64\">\n  <circle cx=\"32\" cy=\"32\" r=\"18\" fill=\"#374151\"/>\n  <ellipse cx=\"26\" cy=\"24\" rx=\"8\" ry=\"6\" fill=\"#4B5563\" opacity=\"0.5\" transform=\"rotate(-30 26 24)\"/>\n</svg>","car":"<svg xmlns=\"http://www.w3.org/2000/svg\" viewBox=\"0 0 64 64\">\n  <rect x=\"6\" y=\"28\" width=\"52\" height=\"14\" rx=\"3\" fill=\"#3B82F6\"/>\n  <path d=\"M16 28 L22 16 H42 L48 28\" fill=\"#60A5FA\"/>\n  <circle cx=\"18\" cy=\"44\" r=\"5\" fill=\"#1E293B\"/>\n  <circle cx=\"46\" cy=\"44\" r=\"5\" fill=\"#1E293B\"/>\n  <circle cx=\"18\" cy=\"44\" r=\"2\" fill=\"#94A3B8\"/>\n  <circle cx=\"46\" cy=\"44\" r=\"2\" fill=\"#94A3B8\"/>\n  <rect x=\"26\" y=\"20\" width=\"8\" height=\"8\" rx=\"1\" fill=\"#BFDBFE\" opacity=\"0.7\"/>\n</svg>","coin":"<svg xmlns=\"http://www.w3.org/2000/svg\" viewBox=\"0 0 64 64\">\n  <circle cx=\"32\" cy=\"32\" r=\"20\" fill=\"#FBBF24\"/>\n  <circle cx=\"32\" cy=\"32\" r=\"20\" fill=\"none\" stroke=\"#B45309\" stroke-width=\"2\"/>\n  <circle cx=\"32\" cy=\"32\" r=\"16\" fill=\"none\" stroke=\"#D97706\" stroke-width=\"1\"/>\n  <text x=\"32\" y=\"38\" text-anchor=\"middle\" font-size=\"18\" font-weight=\"bold\" fill=\"#92400E\">\u00a2</text>\n</svg>","crate":"<svg xmlns=\"http://www.w3.org/2000/svg\" viewBox=\"0 0 64 64\">\n  <rect x=\"10\" y=\"14\" width=\"44\" height=\"40\" rx=\"2\" fill=\"#D97706\"/>\n  <rect x=\"10\" y=\"14\" width=\"44\" height=\"40\" rx=\"2\" fill=\"none\" stroke=\"#78350F\" stroke-width=\"2\"/>\n  <line x1=\"10\" y1=\"24\" x2=\"54\" y2=\"24\" stroke=\"#78350F\" stroke-width=\"1.5\"/>\n  <line x1=\"10\" y1=\"34\" x2=\"54\" y2=\"34\" stroke=\"#78350F\" stroke-width=\"1.5\"/>\n  <line x1=\"10\" y1=\"44\" x2=\"54\" y2=\"44\" stroke=\"#78350F\" stroke-width=\"1.5\"/>\n  <line x1=\"22\" y1=\"14\" x2=\"22\" y2=\"54\" stroke=\"#78350F\" stroke-width=\"1.5\"/>\n  <line x1=\"42\" y1=\"14\" x2=\"42\" y2=\"54\" stroke=\"#78350F\" stroke-width=\"1.5\"/>\n</svg>","cylinder":"<svg xmlns=\"http://www.w3.org/2000/svg\" viewBox=\"0 0 64 64\">\n  <rect x=\"14\" y=\"16\" width=\"36\" height=\"36\" fill=\"#60A5FA\"/>\n  <ellipse cx=\"32\" cy=\"52\" rx=\"18\" ry=\"6\" fill=\"#3B82F6\"/>\n  <ellipse cx=\"32\" cy=\"16\" rx=\"18\" ry=\"6\" fill=\"#93C5FD\"/>\n  <ellipse cx=\"32\" cy=\"16\" rx=\"18\" ry=\"6\" fill=\"none\" stroke=\"#2563EB\" stroke-width=\"1\"/>\n</svg>","dynamics_cart":"<svg xmlns=\"http://www.w3.org/2000/svg\" viewBox=\"0 0 64 64\">\n  <rect x=\"8\" y=\"24\" width=\"48\" height=\"16\" rx=\"2\" fill=\"#22C55E\"/>\n  <rect x=\"8\" y=\"24\" width=\"48\" height=\"4\" fill=\"#16A34A\"/>\n  <circle cx=\"16\" cy=\"44\" r=\"4\" fill=\"#1E293B\"/>\n  <circle cx=\"48\" cy=\"44\" r=\"4\" fill=\"#1E293B\"/>\n  <circle cx=\"16\" cy=\"44\" r=\"1.5\" fill=\"#94A3B8\"/>\n  <circle cx=\"48\" cy=\"44\" r=\"1.5\" fill=\"#94A3B8\"/>\n  <rect x=\"4\" y=\"30\" width=\"6\" height=\"4\" rx=\"1\" fill=\"#94A3B8\"/>\n  <rect x=\"54\" y=\"30\" width=\"6\" height=\"4\" rx=\"1\" fill=\"#94A3B8\"/>\n</svg>","elevator":"<svg xmlns=\"http://www.w3.org/2000/svg\" viewBox=\"0 0 64 64\">\n  <rect x=\"10\" y=\"6\" width=\"44\" height=\"52\" rx=\"2\" fill=\"#94A3B8\"/>\n  <rect x=\"14\" y=\"10\" width=\"17\" height=\"44\" rx=\"1\" fill=\"#475569\"/>\n  <rect x=\"33\" y=\"10\" width=\"17\" height=\"44\" rx=\"1\" fill=\"#475569\"/>\n  <line x1=\"32\" y1=\"10\" x2=\"32\" y2=\"54\" stroke=\"#1E293B\" stroke-width=\"1.5\"/>\n  <polygon points=\"32,14 28,22 36,22\" fill=\"#22C55E\"/>\n  <polygon points=\"32,50 28,42 36,42\" fill=\"#EF4444\"/>\n</svg>","feather":"<svg xmlns=\"http://www.w3.org/2000/svg\" viewBox=\"0 0 64 64\">\n  <path d=\"M32 4 Q42 16 42 28 Q42 44 32 58\" fill=\"none\" stroke=\"#78350F\" stroke-width=\"1.5\"/>\n  <path d=\"M32 4 Q46 12 44 24 Q42 32 38 38 L32 34Z\" fill=\"#A78BFA\"/>\n  <path d=\"M32 4 Q18 12 20 24 Q22 32 26 38 L32 34Z\" fill=\"#C4B5FD\"/>\n  <path d=\"M32 34 Q36 44 34 52 L32 58Z\" fill=\"#A78BFA\" opacity=\"0.6\"/>\n  <path d=\"M32 34 Q28 44 30 52 L32 58Z\" fill=\"#C4B5FD\" opacity=\"0.6\"/>\n</svg>","football":"<svg xmlns=\"http://www.w3.org/2000/svg\" viewBox=\"0 0 64 64\">\n  <ellipse cx=\"32\" cy=\"32\" rx=\"22\" ry=\"13\" fill=\"#92400E\" transform=\"rotate(-30 32 32)\"/>\n  <path d=\"M20 22 L44 42\" stroke=\"#FFF\" stroke-width=\"1.5\"/>\n  <line x1=\"27\" y1=\"27\" x2=\"24\" y2=\"32\" stroke=\"#FFF\" stroke-width=\"1.2\"/>\n  <line x1=\"30\" y1=\"29\" x2=\"27\" y2=\"34\" stroke=\"#FFF\" stroke-width=\"1.2\"/>\n  <line x1=\"34\" y1=\"32\" x2=\"31\" y2=\"37\" stroke=\"#FFF\" stroke-width=\"1.2\"/>\n  <line x1=\"37\" y1=\"34\" x2=\"34\" y2=\"39\" stroke=\"#FFF\" stroke-width=\"1.2\"/>\n</svg>","force_sensor":"<svg xmlns=\"http://www.w3.org/2000/svg\" viewBox=\"0 0 64 64\">\n  <rect x=\"16\" y=\"8\" width=\"32\" height=\"40\" rx=\"4\" fill=\"#1E293B\"/>\n  <rect x=\"20\" y=\"12\" width=\"24\" height=\"14\" rx=\"2\" fill=\"#0F172A\"/>\n  <text x=\"32\" y=\"23\" text-anchor=\"middle\" font-size=\"9\" fill=\"#22C55E\" font-family=\"monospace\">4.9N</text>\n  <rect x=\"28\" y=\"48\" width=\"8\" height=\"12\" rx=\"1\" fill=\"#94A3B8\"/>\n  <circle cx=\"32\" cy=\"62\" r=\"3\" fill=\"#64748B\"/>\n</svg>","golf_ball":"<svg xmlns=\"http://www.w3.org/2000/svg\" viewBox=\"0 0 64 64\">\n  <circle cx=\"32\" cy=\"32\" r=\"20\" fill=\"#F5F5F4\"/>\n  <circle cx=\"32\" cy=\"32\" r=\"20\" fill=\"none\" stroke=\"#D1D5DB\" stroke-width=\"1.5\"/>\n  <circle cx=\"28\" cy=\"26\" r=\"1.5\" fill=\"#D1D5DB\"/>\n  <circle cx=\"34\" cy=\"24\" r=\"1.5\" fill=\"#D1D5DB\"/>\n  <circle cx=\"24\" cy=\"32\" r=\"1.5\" fill=\"#D1D5DB\"/>\n  <circle cx=\"32\" cy=\"30\" r=\"1.5\" fill=\"#D1D5DB\"/>\n  <circle cx=\"38\" cy=\"30\" r=\"1.5\" fill=\"#D1D5DB\"/>\n  <circle cx=\"28\" cy=\"36\" r=\"1.5\" fill=\"#D1D5DB\"/>\n  <circle cx=\"36\" cy=\"36\" r=\"1.5\" fill=\"#D1D5DB\"/>\n  <circle cx=\"32\" cy=\"40\" r=\"1.5\" fill=\"#D1D5DB\"/>\n</svg>","hanging_mass":"<svg xmlns=\"http://www.w3.org/2000/svg\" viewBox=\"0 0 64 64\">\n  <line x1=\"32\" y1=\"4\" x2=\"32\" y2=\"28\" stroke=\"#78350F\" stroke-width=\"2\"/>\n  <rect x=\"20\" y=\"28\" width=\"24\" height=\"28\" rx=\"3\" fill=\"#475569\"/>\n  <rect x=\"20\" y=\"28\" width=\"24\" height=\"28\" rx=\"3\" fill=\"none\" stroke=\"#334155\" stroke-width=\"1.5\"/>\n  <text x=\"32\" y=\"47\" text-anchor=\"middle\" font-size=\"12\" fill=\"#E2E8F0\" font-weight=\"bold\">1kg</text>\n</svg>","hockey_puck":"<svg xmlns=\"http://www.w3.org/2000/svg\" viewBox=\"0 0 64 64\">\n  <ellipse cx=\"32\" cy=\"38\" rx=\"22\" ry=\"8\" fill=\"#0F172A\"/>\n  <ellipse cx=\"32\" cy=\"34\" rx=\"22\" ry=\"8\" fill=\"#1E293B\"/>\n  <rect x=\"10\" y=\"34\" width=\"44\" height=\"4\" fill=\"#1E293B\"/>\n  <ellipse cx=\"32\" cy=\"34\" rx=\"18\" ry=\"5\" fill=\"none\" stroke=\"#374151\" stroke-width=\"1\"/>\n</svg>","marble":"<svg xmlns=\"http://www.w3.org/2000/svg\" viewBox=\"0 0 64 64\">\n  <circle cx=\"32\" cy=\"32\" r=\"18\" fill=\"#2DD4BF\"/>\n  <path d=\"M20 24 Q32 18 44 28 Q36 38 24 36Z\" fill=\"#5EEAD4\" opacity=\"0.4\"/>\n  <ellipse cx=\"26\" cy=\"24\" rx=\"5\" ry=\"3\" fill=\"#FFF\" opacity=\"0.5\" transform=\"rotate(-30 26 24)\"/>\n</svg>","metal_cube":"<svg xmlns=\"http://www.w3.org/2000/svg\" viewBox=\"0 0 64 64\">\n  <rect x=\"14\" y=\"22\" width=\"32\" height=\"32\" fill=\"#94A3B8\"/>\n  <polygon points=\"14,22 26,10 58,10 46,22\" fill=\"#CBD5E1\"/>\n  <polygon points=\"46,22 58,10 58,42 46,54\" fill=\"#64748B\"/>\n  <line x1=\"14\" y1=\"22\" x2=\"46\" y2=\"22\" stroke=\"#475569\" stroke-width=\"1\"/>\n  <line x1=\"46\" y1=\"22\" x2=\"46\" y2=\"54\" stroke=\"#475569\" stroke-width=\"1\"/>\n</svg>","moon":"<svg xmlns=\"http://www.w3.org/2000/svg\" viewBox=\"0 0 64 64\">\n  <circle cx=\"32\" cy=\"32\" r=\"20\" fill=\"#D1D5DB\"/>\n  <circle cx=\"24\" cy=\"26\" r=\"5\" fill=\"#B0B8C4\" opacity=\"0.6\"/>\n  <circle cx=\"38\" cy=\"36\" r=\"4\" fill=\"#B0B8C4\" opacity=\"0.6\"/>\n  <circle cx=\"28\" cy=\"40\" r=\"3\" fill=\"#B0B8C4\" opacity=\"0.5\"/>\n  <circle cx=\"40\" cy=\"24\" r=\"2.5\" fill=\"#B0B8C4\" opacity=\"0.5\"/>\n</svg>","parachute":"<svg xmlns=\"http://www.w3.org/2000/svg\" viewBox=\"0 0 64 64\">\n  <path d=\"M8 24 Q8 4 32 4 Q56 4 56 24Z\" fill=\"#EF4444\"/>\n  <path d=\"M8 24 Q20 20 32 24\" fill=\"#FBBF24\"/>\n  <path d=\"M32 24 Q44 20 56 24\" fill=\"#22C55E\"/>\n  <line x1=\"8\" y1=\"24\" x2=\"30\" y2=\"52\" stroke=\"#78350F\" stroke-width=\"1.5\"/>\n  <line x1=\"56\" y1=\"24\" x2=\"34\" y2=\"52\" stroke=\"#78350F\" stroke-width=\"1.5\"/>\n  <line x1=\"32\" y1=\"24\" x2=\"32\" y2=\"52\" stroke=\"#78350F\" stroke-width=\"1.5\"/>\n  <rect x=\"28\" y=\"52\" width=\"8\" height=\"8\" rx=\"1\" fill=\"#64748B\"/>\n</svg>","pendulum_bob":"<svg xmlns=\"http://www.w3.org/2000/svg\" viewBox=\"0 0 64 64\">\n  <circle cx=\"32\" cy=\"6\" r=\"3\" fill=\"#64748B\"/>\n  <line x1=\"32\" y1=\"6\" x2=\"32\" y2=\"40\" stroke=\"#78350F\" stroke-width=\"2\"/>\n  <circle cx=\"32\" cy=\"46\" r=\"10\" fill=\"#F59E0B\"/>\n  <ellipse cx=\"28\" cy=\"42\" rx=\"4\" ry=\"3\" fill=\"#FBBF24\" opacity=\"0.4\"/>\n</svg>","person":"<svg xmlns=\"http://www.w3.org/2000/svg\" viewBox=\"0 0 64 64\">\n  <circle cx=\"32\" cy=\"14\" r=\"8\" fill=\"#FBBF24\"/>\n  <path d=\"M20 28 Q20 22 32 22 Q44 22 44 28 L44 44 Q44 52 38 52 L26 52 Q20 52 20 44Z\" fill=\"#3B82F6\"/>\n  <rect x=\"22\" y=\"52\" width=\"8\" height=\"10\" rx=\"2\" fill=\"#1E293B\"/>\n  <rect x=\"34\" y=\"52\" width=\"8\" height=\"10\" rx=\"2\" fill=\"#1E293B\"/>\n</svg>","planet":"<svg xmlns=\"http://www.w3.org/2000/svg\" viewBox=\"0 0 64 64\">\n  <circle cx=\"32\" cy=\"32\" r=\"20\" fill=\"#3B82F6\"/>\n  <ellipse cx=\"28\" cy=\"28\" rx=\"10\" ry=\"8\" fill=\"#60A5FA\" opacity=\"0.3\" transform=\"rotate(-20 28 28)\"/>\n  <path d=\"M18 38 Q26 42 36 38 Q42 36 46 40\" fill=\"#22C55E\" opacity=\"0.4\"/>\n  <path d=\"M14 30 Q20 28 26 32\" fill=\"#22C55E\" opacity=\"0.3\"/>\n</svg>","pulley":"<svg xmlns=\"http://www.w3.org/2000/svg\" viewBox=\"0 0 64 64\">\n  <line x1=\"32\" y1=\"4\" x2=\"32\" y2=\"16\" stroke=\"#94A3B8\" stroke-width=\"2\"/>\n  <circle cx=\"32\" cy=\"26\" r=\"10\" fill=\"#E5E7EB\" stroke=\"#64748B\" stroke-width=\"2\"/>\n  <circle cx=\"32\" cy=\"26\" r=\"3\" fill=\"#94A3B8\"/>\n  <line x1=\"22\" y1=\"26\" x2=\"22\" y2=\"58\" stroke=\"#78350F\" stroke-width=\"2\"/>\n  <line x1=\"42\" y1=\"26\" x2=\"42\" y2=\"58\" stroke=\"#78350F\" stroke-width=\"2\"/>\n  <rect x=\"36\" y=\"48\" width=\"12\" height=\"10\" rx=\"1\" fill=\"#F59E0B\"/>\n  <rect x=\"16\" y=\"48\" width=\"12\" height=\"10\" rx=\"1\" fill=\"#3B82F6\"/>\n</svg>","ramp":"<svg xmlns=\"http://www.w3.org/2000/svg\" viewBox=\"0 0 64 64\">\n  <polygon points=\"4,56 60,56 60,16\" fill=\"#94A3B8\"/>\n  <polygon points=\"4,56 60,56 60,16\" fill=\"none\" stroke=\"#64748B\" stroke-width=\"2\"/>\n  <rect x=\"36\" y=\"26\" width=\"12\" height=\"10\" rx=\"1\" fill=\"#F59E0B\" transform=\"rotate(-35 42 31)\"/>\n</svg>","rocket":"<svg xmlns=\"http://www.w3.org/2000/svg\" viewBox=\"0 0 64 64\">\n  <path d=\"M32 4 Q38 14 38 30 L38 44 H26 L26 30 Q26 14 32 4Z\" fill=\"#E5E7EB\"/>\n  <path d=\"M32 4 Q35 14 35 30 L35 44 H32 V4Z\" fill=\"#D1D5DB\"/>\n  <circle cx=\"32\" cy=\"24\" r=\"4\" fill=\"#3B82F6\"/>\n  <path d=\"M26 36 L18 44 L26 44Z\" fill=\"#EF4444\"/>\n  <path d=\"M38 36 L46 44 L38 44Z\" fill=\"#EF4444\"/>\n  <path d=\"M28 44 L24 56 L32 50 L40 56 L36 44Z\" fill=\"#F59E0B\"/>\n  <path d=\"M30 44 L28 52 L32 48 L36 52 L34 44Z\" fill=\"#FBBF24\"/>\n</svg>","rope":"<svg xmlns=\"http://www.w3.org/2000/svg\" viewBox=\"0 0 64 64\">\n  <path d=\"M16 8 Q48 16 32 32 Q16 48 48 56\" fill=\"none\" stroke=\"#D97706\" stroke-width=\"3\" stroke-linecap=\"round\"/>\n  <path d=\"M18 8 Q50 16 34 32 Q18 48 50 56\" fill=\"none\" stroke=\"#B45309\" stroke-width=\"1.5\" stroke-linecap=\"round\" opacity=\"0.5\"/>\n</svg>","runner":"<svg xmlns=\"http://www.w3.org/2000/svg\" viewBox=\"0 0 64 64\">\n  <circle cx=\"34\" cy=\"10\" r=\"6\" fill=\"#FBBF24\"/>\n  <path d=\"M28 20 L38 18 L42 32 L30 34Z\" fill=\"#EF4444\"/>\n  <line x1=\"30\" y1=\"34\" x2=\"20\" y2=\"52\" stroke=\"#1E293B\" stroke-width=\"3\" stroke-linecap=\"round\"/>\n  <line x1=\"36\" y1=\"32\" x2=\"48\" y2=\"48\" stroke=\"#1E293B\" stroke-width=\"3\" stroke-linecap=\"round\"/>\n  <line x1=\"20\" y1=\"52\" x2=\"14\" y2=\"50\" stroke=\"#1E293B\" stroke-width=\"3\" stroke-linecap=\"round\"/>\n  <line x1=\"48\" y1=\"48\" x2=\"52\" y2=\"54\" stroke=\"#1E293B\" stroke-width=\"3\" stroke-linecap=\"round\"/>\n  <line x1=\"38\" y1=\"22\" x2=\"48\" y2=\"18\" stroke=\"#1E293B\" stroke-width=\"3\" stroke-linecap=\"round\"/>\n  <line x1=\"30\" y1=\"24\" x2=\"20\" y2=\"20\" stroke=\"#1E293B\" stroke-width=\"3\" stroke-linecap=\"round\"/>\n</svg>","satellite":"<svg xmlns=\"http://www.w3.org/2000/svg\" viewBox=\"0 0 64 64\">\n  <rect x=\"24\" y=\"24\" width=\"16\" height=\"16\" rx=\"2\" fill=\"#94A3B8\"/>\n  <rect x=\"4\" y=\"28\" width=\"20\" height=\"8\" rx=\"1\" fill=\"#3B82F6\"/>\n  <rect x=\"40\" y=\"28\" width=\"20\" height=\"8\" rx=\"1\" fill=\"#3B82F6\"/>\n  <line x1=\"8\" y1=\"28\" x2=\"8\" y2=\"36\" stroke=\"#2563EB\" stroke-width=\"1\"/>\n  <line x1=\"14\" y1=\"28\" x2=\"14\" y2=\"36\" stroke=\"#2563EB\" stroke-width=\"1\"/>\n  <line x1=\"50\" y1=\"28\" x2=\"50\" y2=\"36\" stroke=\"#2563EB\" stroke-width=\"1\"/>\n  <line x1=\"56\" y1=\"28\" x2=\"56\" y2=\"36\" stroke=\"#2563EB\" stroke-width=\"1\"/>\n  <circle cx=\"32\" cy=\"32\" r=\"3\" fill=\"#FBBF24\"/>\n</svg>","skateboard":"<svg xmlns=\"http://www.w3.org/2000/svg\" viewBox=\"0 0 64 64\">\n  <path d=\"M10 34 Q6 34 6 30 L10 30 H54 L58 30 Q58 34 54 34Z\" fill=\"#92400E\"/>\n  <rect x=\"10\" y=\"30\" width=\"44\" height=\"4\" rx=\"1\" fill=\"#B45309\"/>\n  <rect x=\"12\" y=\"34\" width=\"8\" height=\"3\" rx=\"1\" fill=\"#475569\"/>\n  <rect x=\"44\" y=\"34\" width=\"8\" height=\"3\" rx=\"1\" fill=\"#475569\"/>\n  <circle cx=\"16\" cy=\"40\" r=\"3.5\" fill=\"#1E293B\"/>\n  <circle cx=\"48\" cy=\"40\" r=\"3.5\" fill=\"#1E293B\"/>\n  <circle cx=\"16\" cy=\"40\" r=\"1.5\" fill=\"#94A3B8\"/>\n  <circle cx=\"48\" cy=\"40\" r=\"1.5\" fill=\"#94A3B8\"/>\n</svg>","sled":"<svg xmlns=\"http://www.w3.org/2000/svg\" viewBox=\"0 0 64 64\">\n  <path d=\"M8 44 Q8 36 16 36 H52 Q56 36 56 40\" fill=\"none\" stroke=\"#B45309\" stroke-width=\"3\" stroke-linecap=\"round\"/>\n  <rect x=\"12\" y=\"28\" width=\"36\" height=\"8\" rx=\"2\" fill=\"#D97706\"/>\n  <line x1=\"16\" y1=\"36\" x2=\"16\" y2=\"28\" stroke=\"#92400E\" stroke-width=\"2\"/>\n  <line x1=\"32\" y1=\"36\" x2=\"32\" y2=\"28\" stroke=\"#92400E\" stroke-width=\"2\"/>\n  <line x1=\"44\" y1=\"36\" x2=\"44\" y2=\"28\" stroke=\"#92400E\" stroke-width=\"2\"/>\n  <path d=\"M6 46 Q6 40 14 40\" fill=\"none\" stroke=\"#78350F\" stroke-width=\"3\" stroke-linecap=\"round\"/>\n  <path d=\"M54 40 Q58 40 58 46\" fill=\"none\" stroke=\"#78350F\" stroke-width=\"3\" stroke-linecap=\"round\"/>\n</svg>","soccer_ball":"<svg xmlns=\"http://www.w3.org/2000/svg\" viewBox=\"0 0 64 64\">\n  <circle cx=\"32\" cy=\"32\" r=\"20\" fill=\"#F5F5F4\"/>\n  <circle cx=\"32\" cy=\"32\" r=\"20\" fill=\"none\" stroke=\"#1E293B\" stroke-width=\"1.5\"/>\n  <polygon points=\"32,18 37,24 35,30 29,30 27,24\" fill=\"#1E293B\"/>\n  <polygon points=\"44,34 42,40 36,42 34,36 38,32\" fill=\"#1E293B\"/>\n  <polygon points=\"20,34 22,40 28,42 30,36 26,32\" fill=\"#1E293B\"/>\n</svg>","sphere":"<svg xmlns=\"http://www.w3.org/2000/svg\" viewBox=\"0 0 64 64\">\n  <circle cx=\"32\" cy=\"32\" r=\"20\" fill=\"#A78BFA\"/>\n  <ellipse cx=\"26\" cy=\"24\" rx=\"10\" ry=\"8\" fill=\"#C4B5FD\" opacity=\"0.4\" transform=\"rotate(-30 26 24)\"/>\n</svg>","spring":"<svg xmlns=\"http://www.w3.org/2000/svg\" viewBox=\"0 0 64 64\">\n  <rect x=\"24\" y=\"4\" width=\"16\" height=\"4\" rx=\"1\" fill=\"#94A3B8\"/>\n  <path d=\"M32 8 L42 14 L22 20 L42 26 L22 32 L42 38 L22 44 L42 50 L32 56\" fill=\"none\" stroke=\"#6366F1\" stroke-width=\"2.5\" stroke-linecap=\"round\" stroke-linejoin=\"round\"/>\n  <rect x=\"24\" y=\"56\" width=\"16\" height=\"4\" rx=\"1\" fill=\"#94A3B8\"/>\n</svg>","table":"<svg xmlns=\"http://www.w3.org/2000/svg\" viewBox=\"0 0 64 64\">\n  <rect x=\"6\" y=\"20\" width=\"52\" height=\"6\" rx=\"1\" fill=\"#92400E\"/>\n  <rect x=\"10\" y=\"26\" width=\"4\" height=\"30\" rx=\"1\" fill=\"#78350F\"/>\n  <rect x=\"50\" y=\"26\" width=\"4\" height=\"30\" rx=\"1\" fill=\"#78350F\"/>\n</svg>","tennis_ball":"<svg xmlns=\"http://www.w3.org/2000/svg\" viewBox=\"0 0 64 64\">\n  <circle cx=\"32\" cy=\"32\" r=\"20\" fill=\"#BEF264\"/>\n  <circle cx=\"32\" cy=\"32\" r=\"20\" fill=\"none\" stroke=\"#65A30D\" stroke-width=\"1.5\"/>\n  <path d=\"M14 22 Q24 32 14 42\" fill=\"none\" stroke=\"#F5F5F4\" stroke-width=\"2.5\"/>\n  <path d=\"M50 22 Q40 32 50 42\" fill=\"none\" stroke=\"#F5F5F4\" stroke-width=\"2.5\"/>\n</svg>","train":"<svg xmlns=\"http://www.w3.org/2000/svg\" viewBox=\"0 0 64 64\">\n  <rect x=\"8\" y=\"16\" width=\"48\" height=\"28\" rx=\"4\" fill=\"#6366F1\"/>\n  <rect x=\"12\" y=\"20\" width=\"14\" height=\"12\" rx=\"2\" fill=\"#C7D2FE\" opacity=\"0.7\"/>\n  <rect x=\"30\" y=\"20\" width=\"14\" height=\"12\" rx=\"2\" fill=\"#C7D2FE\" opacity=\"0.7\"/>\n  <rect x=\"8\" y=\"38\" width=\"48\" height=\"4\" fill=\"#4F46E5\"/>\n  <circle cx=\"18\" cy=\"48\" r=\"5\" fill=\"#1E293B\"/>\n  <circle cx=\"46\" cy=\"48\" r=\"5\" fill=\"#1E293B\"/>\n  <circle cx=\"18\" cy=\"48\" r=\"2\" fill=\"#94A3B8\"/>\n  <circle cx=\"46\" cy=\"48\" r=\"2\" fill=\"#94A3B8\"/>\n  <rect x=\"48\" y=\"10\" width=\"4\" height=\"6\" rx=\"1\" fill=\"#4F46E5\"/>\n</svg>","truck":"<svg xmlns=\"http://www.w3.org/2000/svg\" viewBox=\"0 0 64 64\">\n  <rect x=\"4\" y=\"20\" width=\"36\" height=\"22\" rx=\"2\" fill=\"#F59E0B\"/>\n  <rect x=\"40\" y=\"28\" width=\"20\" height=\"14\" rx=\"2\" fill=\"#FBBF24\"/>\n  <rect x=\"44\" y=\"30\" width=\"12\" height=\"8\" rx=\"1\" fill=\"#FEF3C7\" opacity=\"0.6\"/>\n  <circle cx=\"16\" cy=\"46\" r=\"5\" fill=\"#1E293B\"/>\n  <circle cx=\"32\" cy=\"46\" r=\"5\" fill=\"#1E293B\"/>\n  <circle cx=\"52\" cy=\"46\" r=\"5\" fill=\"#1E293B\"/>\n  <circle cx=\"16\" cy=\"46\" r=\"2\" fill=\"#94A3B8\"/>\n  <circle cx=\"32\" cy=\"46\" r=\"2\" fill=\"#94A3B8\"/>\n  <circle cx=\"52\" cy=\"46\" r=\"2\" fill=\"#94A3B8\"/>\n</svg>","wagon":"<svg xmlns=\"http://www.w3.org/2000/svg\" viewBox=\"0 0 64 64\">\n  <rect x=\"8\" y=\"18\" width=\"42\" height=\"22\" rx=\"2\" fill=\"#DC2626\"/>\n  <line x1=\"50\" y1=\"30\" x2=\"60\" y2=\"22\" stroke=\"#7C2D12\" stroke-width=\"3\" stroke-linecap=\"round\"/>\n  <circle cx=\"16\" cy=\"44\" r=\"5\" fill=\"#1E293B\"/>\n  <circle cx=\"42\" cy=\"44\" r=\"5\" fill=\"#1E293B\"/>\n  <circle cx=\"16\" cy=\"44\" r=\"2\" fill=\"#94A3B8\"/>\n  <circle cx=\"42\" cy=\"44\" r=\"2\" fill=\"#94A3B8\"/>\n</svg>","wedge":"<svg xmlns=\"http://www.w3.org/2000/svg\" viewBox=\"0 0 64 64\">\n  <polygon points=\"8,52 56,52 56,20\" fill=\"#F59E0B\"/>\n  <polygon points=\"8,52 56,52 56,20\" fill=\"none\" stroke=\"#B45309\" stroke-width=\"1.5\"/>\n</svg>","wooden_block":"<svg xmlns=\"http://www.w3.org/2000/svg\" viewBox=\"0 0 64 64\">\n  <rect x=\"12\" y=\"20\" width=\"40\" height=\"28\" rx=\"2\" fill=\"#D97706\"/>\n  <rect x=\"12\" y=\"20\" width=\"40\" height=\"28\" rx=\"2\" fill=\"none\" stroke=\"#92400E\" stroke-width=\"1.5\"/>\n  <line x1=\"16\" y1=\"24\" x2=\"16\" y2=\"44\" stroke=\"#B45309\" stroke-width=\"0.8\" opacity=\"0.5\"/>\n  <line x1=\"22\" y1=\"22\" x2=\"22\" y2=\"46\" stroke=\"#B45309\" stroke-width=\"0.8\" opacity=\"0.5\"/>\n  <line x1=\"36\" y1=\"22\" x2=\"36\" y2=\"46\" stroke=\"#B45309\" stroke-width=\"0.8\" opacity=\"0.5\"/>\n  <line x1=\"48\" y1=\"24\" x2=\"48\" y2=\"44\" stroke=\"#B45309\" stroke-width=\"0.8\" opacity=\"0.5\"/>\n</svg>","wrecking_ball":"<svg xmlns=\"http://www.w3.org/2000/svg\" viewBox=\"0 0 64 64\">\n  <line x1=\"32\" y1=\"2\" x2=\"38\" y2=\"24\" stroke=\"#94A3B8\" stroke-width=\"2.5\"/>\n  <circle cx=\"32\" cy=\"2\" r=\"3\" fill=\"#64748B\"/>\n  <circle cx=\"40\" cy=\"36\" r=\"16\" fill=\"#374151\"/>\n  <ellipse cx=\"34\" cy=\"30\" rx=\"6\" ry=\"4\" fill=\"#4B5563\" opacity=\"0.4\"/>\n</svg>"};

const STATUSES = ["draft", "revised", "approved", "idea_only"];
const SC = {
  draft:     { label: "Draft",     c: "#6366F1", bg: "#EEEDFE", dk: "#3C3489" },
  revised:   { label: "Revised",   c: "#D85A30", bg: "#FAECE7", dk: "#712B13" },
  approved:  { label: "Approved",  c: "#1D9E75", bg: "#E1F5EE", dk: "#085041" },
  idea_only: { label: "Idea only", c: "#BA7517", bg: "#FAEEDA", dk: "#412402" },
};

const RAMPS = {
  blue:   { l: "#BFDBFE", m: "#3B82F6", d: "#1E3A8A", n: "Blue" },
  red:    { l: "#FECACA", m: "#EF4444", d: "#991B1B", n: "Red" },
  green:  { l: "#BBF7D0", m: "#22C55E", d: "#166534", n: "Green" },
  amber:  { l: "#FDE68A", m: "#F59E0B", d: "#92400E", n: "Amber" },
  purple: { l: "#DDD6FE", m: "#8B5CF6", d: "#5B21B6", n: "Purple" },
  teal:   { l: "#99F6E4", m: "#14B8A6", d: "#115E59", n: "Teal" },
  gray:   { l: "#E5E7EB", m: "#6B7280", d: "#1F2937", n: "Gray" },
  pink:   { l: "#FBCFE8", m: "#EC4899", d: "#9D174D", n: "Pink" },
};

const SK = "gist-svg-v2";

function init() {
  return Object.keys(SVG_DATA).map(k => ({
    id: k, label: k.replace(/_/g, " "), svg: SVG_DATA[k],
    status: "draft", feedback: [], notes: "", colorTag: null,
  }));
}

export default function App() {
  const [items, setItemsRaw] = useState(null);
  const [loaded, setLoaded] = useState(false);
  const undo = useRef([]);
  const [hasUndo, setHasUndo] = useState(false);
  const [modal, setModal] = useState(null);
  const [filters, setFilters] = useState(new Set(STATUSES));
  const [search, setSearch] = useState("");
  const [fbText, setFbText] = useState("");
  const [showSP, setShowSP] = useState(false);
  const [toast, setToast] = useState(null);
  const taRef = useRef(null);
  const tRef = useRef(null);

  const save = d => { try { window.storage.set(SK, JSON.stringify(d)); } catch(e){} };

  const setItems = useCallback((fn) => {
    setItemsRaw(prev => {
      if (prev) { undo.current = [...undo.current.slice(-29), JSON.stringify(prev)]; setHasUndo(true); }
      const next = typeof fn === "function" ? fn(prev) : fn;
      save(next);
      return next;
    });
  }, []);

  const doUndo = useCallback(() => {
    if (!undo.current.length) return;
    const prev = JSON.parse(undo.current.pop());
    setHasUndo(undo.current.length > 0);
    setItemsRaw(prev); save(prev);
    flash("Undone");
  }, []);

  useEffect(() => {
    (async () => {
      try {
        const r = await window.storage.get(SK);
        if (r?.value) { const p = JSON.parse(r.value); if (Array.isArray(p) && p.length) { setItemsRaw(p); setLoaded(true); return; } }
      } catch(e){}
      setItemsRaw(init()); setLoaded(true);
    })();
  }, []);

  useEffect(() => {
    const h = e => {
      if ((e.metaKey||e.ctrlKey) && e.key === "z" && !modal) { e.preventDefault(); doUndo(); }
      if (e.key === "Escape") { if (showSP) setShowSP(false); else if (modal) closeModal(); }
      if (modal && !showSP && e.key === "ArrowLeft") nav(-1);
      if (modal && !showSP && e.key === "ArrowRight") nav(1);
    };
    window.addEventListener("keydown", h);
    return () => window.removeEventListener("keydown", h);
  });

  useEffect(() => { if (modal && taRef.current) taRef.current.focus(); }, [modal]);

  const flash = msg => {
    setToast(msg); if(tRef.current) clearTimeout(tRef.current);
    tRef.current = setTimeout(() => setToast(null), 2200);
  };

  const closeModal = () => { setModal(null); setFbText(""); };

  const nav = dir => {
    if (!modal || !items) return;
    const v = vis(); const i = v.findIndex(x => x.id === modal.id);
    const n = v[i + dir]; if (n) { setModal(n); setFbText(""); }
  };

  const sync = (id, fn) => { if (modal?.id === id) setModal(m => fn(m)); };

  const setStatus = (id, s) => {
    setItems(p => p.map(i => i.id === id ? {...i, status: s} : i));
    sync(id, m => ({...m, status: s}));
  };

  const setNotes = (id, notes) => {
    setItems(p => p.map(i => i.id === id ? {...i, notes} : i));
    sync(id, m => ({...m, notes}));
  };

  const setColor = (id, colorTag) => {
    setItems(p => p.map(i => i.id === id ? {...i, colorTag} : i));
    sync(id, m => ({...m, colorTag}));
  };

  const addFb = id => {
    if (!fbText.trim()) return;
    const e = { text: fbText.trim(), date: new Date().toISOString() };
    setItems(p => p.map(i => i.id === id ? {...i, feedback: [...i.feedback, e], status: i.status === "draft" ? "revised" : i.status} : i));
    sync(id, m => ({...m, feedback: [...m.feedback, e], status: m.status === "draft" ? "revised" : m.status}));
    setFbText(""); flash("Feedback saved");
  };

  const vis = useCallback(() => {
    if (!items) return [];
    return items.filter(i => filters.has(i.status) && (!search || i.label.toLowerCase().includes(search.toLowerCase())));
  }, [items, filters, search]);

  const counts = items ? STATUSES.reduce((a,s) => { a[s] = items.filter(i => i.status === s).length; return a; }, {}) : {};

  const togFilter = s => {
    setFilters(prev => {
      if (prev.size === STATUSES.length) return new Set([s]);
      if (prev.size === 1 && prev.has(s)) return new Set(STATUSES);
      const n = new Set(prev);
      if (n.has(s)) n.delete(s); else n.add(s);
      return n.size === 0 ? new Set(STATUSES) : n;
    });
  };

  if (!loaded || !items) return <div style={{padding:"2rem",textAlign:"center",color:"var(--color-text-secondary)"}}>Loading...</div>;

  const visible = vis();
  const isIdea = modal?.status === "idea_only";
  const SP = `You generate SVG icons for the GIST project (LLM \u2192 JSON \u2192 Planck.js). Rules:\n- 64x64 viewBox, simple silhouettes, Tailwind-inspired fills\n- No external deps, inline styles only\n- Monochromatic 3-tone (light/mid/dark from same hue)\n- People: abstract non-skin colors for inclusivity\n- Categories: vehicles, projectiles, blocks, people, connectors, planes, pendulums, everyday, lab, space, air resistance\n\nLibrary (${items.length}): ${items.map(i=>i.id).join(", ")}`;

  return (
    <div style={{padding:"1rem 0",fontFamily:"var(--font-sans)",maxWidth:960,margin:"0 auto"}}>
      {toast && <div style={{position:"fixed",top:16,left:"50%",transform:"translateX(-50%)",zIndex:9999,background:"var(--color-background-success)",color:"var(--color-text-success)",padding:"8px 20px",borderRadius:"var(--border-radius-md)",fontSize:13,fontWeight:500,border:"0.5px solid var(--color-border-success)"}}>{toast}</div>}

      <div style={{display:"flex",alignItems:"center",justifyContent:"space-between",marginBottom:16,flexWrap:"wrap",gap:8}}>
        <div style={{fontSize:18,fontWeight:500,color:"var(--color-text-primary)"}}>
          GIST physics SVG library
          <span style={{fontSize:13,color:"var(--color-text-secondary)",marginLeft:8}}>{items.length} objects</span>
        </div>
        <div style={{display:"flex",gap:6,flexWrap:"wrap",alignItems:"center"}}>
          {hasUndo && <button onClick={doUndo} style={{fontSize:12,color:"var(--color-text-info)"}} title="Ctrl/Cmd+Z">Undo</button>}
          <button onClick={() => sendPrompt(`Generate 10 more physics SVGs for GIST. Same style (64x64, Tailwind fills). Existing: ${items.map(i=>i.id).join(", ")}. New objects only.`)} style={{fontSize:13}}>Generate more &#8599;</button>
          <button onClick={() => setShowSP(true)} style={{fontSize:13}}>System prompt</button>
          <button onClick={() => {
            const a = items.filter(i => i.status === "approved");
            if (!a.length) { flash("No approved SVGs"); return; }
            sendPrompt(`Create a zip of ${a.length} approved GIST SVGs: ${a.map(x=>x.id).join(", ")}. Include feedback-log.json.`);
          }} style={{fontSize:13}}>Download approved &#8599;</button>
        </div>
      </div>

      <input type="text" placeholder="Search objects..." value={search} onChange={e => setSearch(e.target.value)} style={{width:"100%",marginBottom:10}} />

      <div style={{display:"flex",gap:6,alignItems:"center",marginBottom:16,flexWrap:"wrap"}}>
        <span style={{fontSize:12,color:"var(--color-text-tertiary)",marginRight:2}}>Filter:</span>
        {STATUSES.map(s => {
          const cfg = SC[s], on = filters.has(s), solo = filters.size === 1 && on;
          return <button key={s} onClick={() => togFilter(s)} style={{
            fontSize:12,padding:"4px 10px",borderRadius:"var(--border-radius-md)",cursor:"pointer",
            background:on?cfg.bg:"transparent",color:on?cfg.dk:"var(--color-text-tertiary)",
            border:solo?`2px solid ${cfg.c}`:on?`0.5px solid ${cfg.c}40`:"0.5px solid var(--color-border-tertiary)",
            fontWeight:on?500:400,
          }}>{cfg.label} ({counts[s]||0})</button>;
        })}
        <span style={{flex:1}} />
        <button onClick={() => { setItems(p => p.map(i => i.status==="draft"?{...i,status:"idea_only"}:i)); flash("All drafts \u2192 idea only"); }}
          style={{fontSize:11,padding:"3px 8px",color:"var(--color-text-warning)"}}>All drafts \u2192 idea only</button>
      </div>

      <div style={{display:"grid",gridTemplateColumns:"repeat(auto-fill, minmax(100px, 1fr))",gap:10}}>
        {visible.map(item => {
          const cfg = SC[item.status];
          return <div key={item.id} onClick={() => { setModal(item); setFbText(""); }}
            style={{background:"var(--color-background-primary)",borderRadius:"var(--border-radius-lg)",
              border:"0.5px solid var(--color-border-tertiary)",padding:10,cursor:"pointer",textAlign:"center",
              transition:"border-color 0.15s",position:"relative"}}
            onMouseEnter={e => e.currentTarget.style.borderColor = cfg.c}
            onMouseLeave={e => e.currentTarget.style.borderColor = ""}>
            <div dangerouslySetInnerHTML={{__html:item.svg}} style={{width:56,height:56,margin:"0 auto 6px"}} />
            <div style={{fontSize:11,color:"var(--color-text-secondary)",lineHeight:1.3,marginBottom:4}}>{item.label}</div>
            <div style={{fontSize:10,padding:"2px 6px",borderRadius:"var(--border-radius-md)",background:cfg.bg,color:cfg.dk,display:"inline-block",fontWeight:500}}>{cfg.label}</div>
            {item.feedback.length > 0 && <div style={{position:"absolute",top:4,right:4,minWidth:16,height:16,borderRadius:"50%",background:"var(--color-background-info)",color:"var(--color-text-info)",fontSize:10,display:"flex",alignItems:"center",justifyContent:"center",fontWeight:500}}>{item.feedback.length}</div>}
            {item.colorTag && <div style={{position:"absolute",top:4,left:4,width:8,height:8,borderRadius:"50%",background:RAMPS[item.colorTag]?.m}} />}
          </div>;
        })}
      </div>

      {visible.length === 0 && <div style={{textAlign:"center",padding:"3rem 1rem",color:"var(--color-text-tertiary)",fontSize:14}}>No matches. Click a filter to solo it, click again to show all.</div>}

      {modal && <div style={{position:"fixed",inset:0,background:"rgba(0,0,0,0.5)",zIndex:1000,display:"flex",alignItems:"center",justifyContent:"center",padding:16}}
        onClick={e => { if (e.target === e.currentTarget) closeModal(); }}>
        <div style={{background:"var(--color-background-primary)",borderRadius:"var(--border-radius-lg)",border:"0.5px solid var(--color-border-secondary)",width:"100%",maxWidth:520,maxHeight:"90vh",overflowY:"auto",padding:"1.25rem"}}>
          <div style={{display:"flex",justifyContent:"space-between",alignItems:"center",marginBottom:16}}>
            <div style={{fontSize:16,fontWeight:500,color:"var(--color-text-primary)",textTransform:"capitalize"}}>{modal.label}</div>
            <button onClick={closeModal} style={{fontSize:18,lineHeight:1,padding:"2px 8px",color:"var(--color-text-secondary)"}}>&times;</button>
          </div>

          <div style={{background:"var(--color-background-secondary)",borderRadius:"var(--border-radius-md)",padding:24,textAlign:"center",marginBottom:16}}>
            <div dangerouslySetInnerHTML={{__html:modal.svg}} style={{width:180,height:180,margin:"0 auto"}} />
          </div>

          <div style={{display:"flex",gap:6,marginBottom:12,flexWrap:"wrap"}}>
            {STATUSES.map(s => {
              const cfg = SC[s], on = modal.status === s;
              return <button key={s} onClick={() => setStatus(modal.id, s)} style={{
                fontSize:12,padding:"5px 12px",borderRadius:"var(--border-radius-md)",cursor:"pointer",
                background:on?cfg.bg:"transparent",color:on?cfg.dk:"var(--color-text-tertiary)",
                border:on?`2px solid ${cfg.c}`:"0.5px solid var(--color-border-tertiary)",fontWeight:on?500:400,
              }}>{cfg.label}</button>;
            })}
          </div>

          <div style={{marginBottom:12}}>
            <div style={{fontSize:12,fontWeight:500,color:"var(--color-text-secondary)",marginBottom:6}}>Color palette tag</div>
            <div style={{display:"flex",gap:6,flexWrap:"wrap",alignItems:"center"}}>
              {Object.entries(RAMPS).map(([k,r]) =>
                <button key={k} onClick={() => setColor(modal.id, modal.colorTag===k?null:k)} title={r.n}
                  style={{width:28,height:28,borderRadius:"50%",cursor:"pointer",padding:0,
                    background:`linear-gradient(135deg, ${r.l} 33%, ${r.m} 66%, ${r.d})`,
                    border:modal.colorTag===k?"2px solid var(--color-text-primary)":"2px solid transparent",
                    outline:modal.colorTag===k?"2px solid var(--color-background-primary)":"none"}} />
              )}
              {modal.colorTag && <span style={{fontSize:11,color:"var(--color-text-tertiary)",marginLeft:4}}>
                {RAMPS[modal.colorTag].n}: {RAMPS[modal.colorTag].l} / {RAMPS[modal.colorTag].m} / {RAMPS[modal.colorTag].d}
              </span>}
            </div>
          </div>

          {modal.feedback.length > 0 && <div style={{marginBottom:12}}>
            <div style={{fontSize:12,fontWeight:500,color:"var(--color-text-secondary)",marginBottom:6}}>Feedback history</div>
            {modal.feedback.map((f,i) => <div key={i} style={{background:"var(--color-background-secondary)",borderRadius:"var(--border-radius-md)",padding:"8px 10px",marginBottom:4,fontSize:13,color:"var(--color-text-primary)"}}>
              <span style={{color:"var(--color-text-tertiary)",fontSize:11,marginRight:8}}>{new Date(f.date).toLocaleDateString()}</span>{f.text}
            </div>)}
          </div>}

          {isIdea ? (
            <div style={{marginBottom:8}}>
              <div style={{fontSize:12,fontWeight:500,color:"var(--color-text-secondary)",marginBottom:4}}>Notes &mdash; how this fits the physics engine</div>
              <textarea ref={taRef} value={modal.notes||""} placeholder="e.g. Ropes will be implemented via distance joints in Planck.js..."
                onChange={e => setNotes(modal.id, e.target.value)}
                style={{width:"100%",minHeight:70,resize:"vertical",fontSize:13}} />
            </div>
          ) : (<>
            <textarea ref={taRef} value={fbText} onChange={e => setFbText(e.target.value)}
              placeholder="Add feedback for next revision..."
              style={{width:"100%",minHeight:60,resize:"vertical",fontSize:13,marginBottom:4}}
              onKeyDown={e => { if (e.key==="Enter"&&(e.metaKey||e.ctrlKey)) { e.preventDefault(); addFb(modal.id); }}} />
            <div style={{display:"flex",justifyContent:"space-between",alignItems:"center",marginBottom:4}}>
              <span style={{fontSize:11,color:"var(--color-text-tertiary)"}}>Cmd+Enter to save &middot; Esc close &middot; &larr;&rarr; nav</span>
              <button onClick={() => addFb(modal.id)} style={{fontSize:13}}>Save feedback</button>
            </div>
          </>)}

          <div style={{display:"flex",justifyContent:"space-between",marginTop:8,borderTop:"0.5px solid var(--color-border-tertiary)",paddingTop:10}}>
            <button onClick={() => nav(-1)} style={{fontSize:12,color:"var(--color-text-secondary)"}}>&larr; Previous</button>
            <button onClick={() => {
              const fb = modal.feedback.map(f=>f.text).join("; ");
              const ex = fbText ? "; "+fbText : "";
              const cl = modal.colorTag ? ` Use ${RAMPS[modal.colorTag].n} 3-tone (${RAMPS[modal.colorTag].l}/${RAMPS[modal.colorTag].m}/${RAMPS[modal.colorTag].d}).` : "";
              sendPrompt(`Revise "${modal.id}" SVG for GIST. Feedback: ${fb}${ex}.${cl} Current:\n${modal.svg}`);
            }} style={{fontSize:12}}>Send to Claude &#8599;</button>
            <button onClick={() => nav(1)} style={{fontSize:12,color:"var(--color-text-secondary)"}}>Next &rarr;</button>
          </div>
        </div>
      </div>}

      {showSP && <div style={{position:"fixed",inset:0,background:"rgba(0,0,0,0.5)",zIndex:1000,display:"flex",alignItems:"center",justifyContent:"center",padding:16}}
        onClick={e => { if (e.target===e.currentTarget) setShowSP(false); }}>
        <div style={{background:"var(--color-background-primary)",borderRadius:"var(--border-radius-lg)",border:"0.5px solid var(--color-border-secondary)",width:"100%",maxWidth:600,maxHeight:"90vh",overflowY:"auto",padding:"1.25rem"}}>
          <div style={{display:"flex",justifyContent:"space-between",alignItems:"center",marginBottom:12}}>
            <div style={{fontSize:16,fontWeight:500,color:"var(--color-text-primary)"}}>Generation system prompt</div>
            <button onClick={() => setShowSP(false)} style={{fontSize:18,padding:"2px 8px",color:"var(--color-text-secondary)"}}>&times;</button>
          </div>
          <div style={{background:"var(--color-background-secondary)",borderRadius:"var(--border-radius-md)",padding:14,fontSize:13,lineHeight:1.7,color:"var(--color-text-primary)",fontFamily:"var(--font-mono)",whiteSpace:"pre-wrap"}}>{SP}</div>
          <div style={{marginTop:12,fontSize:12,color:"var(--color-text-secondary)"}}>Included when you click "Generate more." Carries full inventory to avoid duplicates.</div>
        </div>
      </div>}
    </div>
  );
}
