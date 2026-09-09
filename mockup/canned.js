/*
 * GENERATED — do not edit by hand. Run `node mockup/generate-canned.mjs`.
 *
 * Every number below came out of the real engines on 2026-09-09: real
 * EVs, real chart margins, real dealer odds, real explanation sentences, real
 * UTH solver output. The mockups are not wired to anything, but they are not
 * lying about what the app can say.
 *
 * Deliberately a classic script rather than an ES module: browsers refuse module
 * imports over file://, and these pages have to open on a double-click.
 */

var CANNED = {
  "generatedAt": "2026-09-09",
  "ruleSet": {
    "id": "vegas-strip-6d-s17",
    "name": "Vegas Strip 6-deck S17",
    "badge": "6D · S17 · DAS · late surrender · 3:2",
    "edgePercent": 0.33
  },
  "player": {
    "name": "Idan",
    "initial": "I"
  },
  "rating": {
    "blackjack": {
      "mode": "basic",
      "rating": 1642,
      "peak": 1701,
      "session": -8,
      "decisions": 412
    },
    "ultimate": {
      "mode": "basic",
      "rating": null,
      "peak": null,
      "session": 0,
      "decisions": 0
    }
  },
  "stats": {
    "hands": 1240,
    "decisions": 1583,
    "correct": 1541,
    "accuracy": 0.9735,
    "evLost": 4.94,
    "evLostPer100": 0.398,
    "effectiveHouseEdgePercent": 0.73,
    "netUnits": -13,
    "bySeverity": {
      "optimal": 1541,
      "negligible": 12,
      "minor": 18,
      "significant": 9,
      "blunder": 3
    }
  },
  "table": {
    "dealer": [
      {
        "rank": "10",
        "suit": "♥",
        "red": true,
        "label": "ten of hearts"
      }
    ],
    "hand": [
      {
        "rank": "10",
        "suit": "♠",
        "red": false,
        "label": "ten of spades"
      },
      {
        "rank": "6",
        "suit": "♦",
        "red": true,
        "label": "6 of diamonds"
      }
    ],
    "total": 16,
    "legalActions": [
      "stand",
      "hit",
      "double",
      "surrender"
    ]
  },
  "live": {
    "scenarioKey": "bj:hard16:vs10",
    "optimal": "surrender",
    "chosen": "stand",
    "correct": false,
    "evCost": 0.0401,
    "severity": "significant",
    "margin": 0.0346,
    "ranked": [
      {
        "action": "surrender",
        "ev": -0.5
      },
      {
        "action": "hit",
        "ev": -0.5346
      },
      {
        "action": "stand",
        "ev": -0.5401
      },
      {
        "action": "double",
        "ev": -1.0691
      }
    ],
    "headline": "16 vs 10 → Surrender",
    "steps": [
      "Dealer shows a ten. They break just 23% of the time and finish with 17 or better the other 77%. You need a real hand.",
      "16 — a stiff. You cannot win it by standing, and you break 62% of the time if you draw. There is no comfortable answer, only a cheaper one.",
      "Surrender, and it is a narrow call: -0.500 against -0.535 for hitting. Drawing breaks this hand 62% of the time on the very next card, and even played out perfectly it only reaches -0.535 — against the guaranteed -0.500 of giving half of it back."
    ],
    "reason": "Surrender, and it is a narrow call: -0.500 against -0.535 for hitting. Drawing breaks this hand 62% of the time on the very next card, and even played out perfectly it only reaches -0.535 — against the guaranteed -0.500 of giving half of it back.",
    "sensitivity": [
      {
        "label": "without late surrender",
        "action": "hit",
        "letter": "H"
      }
    ],
    "difficulty": 1569,
    "frequency": 0.018229835717648184,
    "dealerOdds": {
      "bust": 0.230238539665933,
      "madeHand": 0.769761460334067
    },
    "bustOnHit": 0.6153846153846154
  },
  "handLog": [
    {
      "id": 214,
      "scenarioKey": "bj:pair8:vs10",
      "player": "8♠ 8♣",
      "dealer": "10♦ 7♥",
      "chosen": "split",
      "optimal": "split",
      "correct": true,
      "evCost": 0,
      "severity": "optimal",
      "net": -2,
      "difficulty": 1778,
      "ratingDelta": 16,
      "ranked": [
        {
          "action": "split",
          "ev": -0.4751
        },
        {
          "action": "surrender",
          "ev": -0.5
        },
        {
          "action": "hit",
          "ev": -0.5351
        },
        {
          "action": "stand",
          "ev": -0.5369
        },
        {
          "action": "double",
          "ev": -1.0702
        }
      ],
      "reason": "Split, and it is a narrow call: -0.475 against -0.500 for surrendering. Two hands are worth 0.025 more here than one, which is what surrendering it as a single total gives away.",
      "sensitivity": [
        {
          "label": "in a no-hole-card game",
          "action": "surrender",
          "letter": "R"
        }
      ]
    },
    {
      "id": 213,
      "scenarioKey": "bj:soft18:vs9",
      "player": "A♥ 7♦",
      "dealer": "9♠ K♣",
      "chosen": "stand",
      "optimal": "hit",
      "correct": false,
      "evCost": 0.0832,
      "severity": "significant",
      "net": -1,
      "difficulty": 1611,
      "ratingDelta": -13,
      "ranked": [
        {
          "action": "hit",
          "ev": -0.0994
        },
        {
          "action": "stand",
          "ev": -0.1826
        },
        {
          "action": "double",
          "ev": -0.2865
        },
        {
          "action": "surrender",
          "ev": -0.5
        }
      ],
      "reason": "Hit, and it is the right play, though closer than it looks: -0.099 against -0.183 for standing. Drawing cannot break a soft hand — the ace simply drops to one — so the draw costs nothing but the total you already had, and a 9 is strong enough that the total you already had is not enough.",
      "sensitivity": []
    },
    {
      "id": 212,
      "scenarioKey": "bj:hard12:vs4",
      "player": "9♣ 3♦",
      "dealer": "4♥ 10♠ 9♦",
      "chosen": "hit",
      "optimal": "stand",
      "correct": false,
      "evCost": 0.004,
      "severity": "negligible",
      "net": 1,
      "difficulty": 2011,
      "ratingDelta": -3,
      "ranked": [
        {
          "action": "stand",
          "ev": -0.2088
        },
        {
          "action": "hit",
          "ev": -0.2129
        },
        {
          "action": "double",
          "ev": -0.4257
        },
        {
          "action": "surrender",
          "ev": -0.5
        }
      ],
      "reason": "Stand, and it is a coin-flip — either is defensible, this one edges it: -0.209 against -0.213 for hitting. Standing on 12 wins only when the dealer breaks, and a 4 breaks 40% of the time.",
      "sensitivity": []
    },
    {
      "id": 211,
      "scenarioKey": "bj:hard11:vs6",
      "player": "5♠ 6♥",
      "dealer": "6♦ K♣ 9♥",
      "chosen": "double",
      "optimal": "double",
      "correct": true,
      "evCost": 0,
      "severity": "optimal",
      "net": 2,
      "difficulty": 1278,
      "ratingDelta": 3,
      "ranked": [
        {
          "action": "double",
          "ev": 0.6743
        },
        {
          "action": "hit",
          "ev": 0.3371
        },
        {
          "action": "stand",
          "ev": -0.1524
        },
        {
          "action": "surrender",
          "ev": -0.5
        }
      ],
      "reason": "Double, and it is not close: 0.674 against 0.337 for hitting. Doubling takes the same card as hitting, for twice the stake and no second draw. It wins when that one card is usually enough — and against a 6 it usually is.",
      "sensitivity": []
    },
    {
      "id": 210,
      "scenarioKey": "bj:hard16:vs10",
      "player": "10♥ 6♠",
      "dealer": "10♣ 8♦",
      "chosen": "stand",
      "optimal": "surrender",
      "correct": false,
      "evCost": 0.0401,
      "severity": "significant",
      "net": -0.5,
      "difficulty": 1569,
      "ratingDelta": -14,
      "ranked": [
        {
          "action": "surrender",
          "ev": -0.5
        },
        {
          "action": "hit",
          "ev": -0.5346
        },
        {
          "action": "stand",
          "ev": -0.5401
        },
        {
          "action": "double",
          "ev": -1.0691
        }
      ],
      "reason": "Surrender, and it is a narrow call: -0.500 against -0.535 for hitting. Drawing breaks this hand 62% of the time on the very next card, and even played out perfectly it only reaches -0.535 — against the guaranteed -0.500 of giving half of it back.",
      "sensitivity": [
        {
          "label": "without late surrender",
          "action": "hit",
          "letter": "H"
        }
      ]
    },
    {
      "id": 209,
      "scenarioKey": "bj:soft13:vs5",
      "player": "A♣ 2♥",
      "dealer": "5♦ J♠ 6♣",
      "chosen": "hit",
      "optimal": "double",
      "correct": false,
      "evCost": 0.0018,
      "severity": "negligible",
      "net": -2,
      "difficulty": 2200,
      "ratingDelta": -1,
      "ranked": [
        {
          "action": "double",
          "ev": 0.1394
        },
        {
          "action": "hit",
          "ev": 0.1376
        },
        {
          "action": "stand",
          "ev": -0.1594
        },
        {
          "action": "surrender",
          "ev": -0.5
        }
      ],
      "reason": "Double, and it is a coin-flip — either is defensible, this one edges it: 0.139 against 0.138 for hitting. Drawing cannot break a soft hand — the ace simply drops to one — so the draw costs nothing but the total you already had, and a 5 is strong enough that the total you already had is not enough.",
      "sensitivity": []
    },
    {
      "id": 208,
      "scenarioKey": "bj:pairT:vs9",
      "player": "K♥ Q♣",
      "dealer": "9♦ 10♥",
      "chosen": "split",
      "optimal": "stand",
      "correct": false,
      "evCost": 0.9699,
      "severity": "blunder",
      "net": 1,
      "difficulty": 1050,
      "ratingDelta": -23,
      "ranked": [
        {
          "action": "stand",
          "ev": 0.7561
        },
        {
          "action": "split",
          "ev": -0.2138
        },
        {
          "action": "surrender",
          "ev": -0.5
        },
        {
          "action": "hit",
          "ev": -0.8494
        },
        {
          "action": "double",
          "ev": -1.6988
        }
      ],
      "reason": "Stand, and it is not close: 0.756 against -0.214 for splitting. Splitting it costs 0.970 against simply standing — breaking up this pair turns one good total into two worse ones.",
      "sensitivity": []
    },
    {
      "id": 207,
      "scenarioKey": "bj:hard14:vs3",
      "player": "10♠ 4♦",
      "dealer": "3♣ 9♥ J♦",
      "chosen": "stand",
      "optimal": "stand",
      "correct": true,
      "evCost": 0,
      "severity": "optimal",
      "net": 1,
      "difficulty": 1465,
      "ratingDelta": 6,
      "ranked": [
        {
          "action": "stand",
          "ev": -0.2509
        },
        {
          "action": "hit",
          "ev": -0.3496
        },
        {
          "action": "surrender",
          "ev": -0.5
        },
        {
          "action": "double",
          "ev": -0.6992
        }
      ],
      "reason": "Stand, and it is the right play, though closer than it looks: -0.251 against -0.350 for hitting. Standing on 14 wins only when the dealer breaks, and a 3 breaks 37% of the time.",
      "sensitivity": []
    }
  ],
  "ladder": [
    {
      "scenarioKey": "bj:pairT:vs9",
      "label": "10,10 vs 9",
      "difficulty": 1050,
      "margin": 0.9699,
      "optimal": "stand",
      "oneIn": 137
    },
    {
      "scenarioKey": "bj:hard12:vs10",
      "label": "12 vs 10",
      "difficulty": 1327,
      "margin": 0.1223,
      "optimal": "hit",
      "oneIn": 39
    },
    {
      "scenarioKey": "bj:pair8:vs6",
      "label": "8,8 vs 6",
      "difficulty": 1327,
      "margin": 0.5626,
      "optimal": "split",
      "oneIn": 2271
    },
    {
      "scenarioKey": "bj:hard16:vs10",
      "label": "16 vs 10",
      "difficulty": 1569,
      "margin": 0.0346,
      "optimal": "surrender",
      "oneIn": 55
    },
    {
      "scenarioKey": "bj:soft18:vs9",
      "label": "A,7 vs 9",
      "difficulty": 1611,
      "margin": 0.0832,
      "optimal": "hit",
      "oneIn": 1088
    },
    {
      "scenarioKey": "bj:hard15:vs10",
      "label": "15 vs 10",
      "difficulty": 1972,
      "margin": 0.0032,
      "optimal": "surrender",
      "oneIn": 46
    },
    {
      "scenarioKey": "bj:soft13:vs5",
      "label": "A,2 vs 5",
      "difficulty": 2200,
      "margin": 0.0018,
      "optimal": "double",
      "oneIn": 1088
    }
  ],
  "uth": {
    "solvedClasses": 103,
    "totalClasses": 169,
    "hole": [
      {
        "rank": "A",
        "suit": "♥",
        "red": true,
        "label": "ace of hearts"
      },
      {
        "rank": "K",
        "suit": "♥",
        "red": true,
        "label": "king of hearts"
      }
    ],
    "board": [
      {
        "rank": "Q",
        "suit": "♥",
        "red": true,
        "label": "queen of hearts"
      },
      {
        "rank": "J",
        "suit": "♥",
        "red": true,
        "label": "jack of hearts"
      },
      {
        "rank": "2",
        "suit": "♦",
        "red": true,
        "label": "2 of diamonds"
      },
      {
        "rank": "7",
        "suit": "♣",
        "red": false,
        "label": "7 of clubs"
      },
      {
        "rank": "4",
        "suit": "♠",
        "red": false,
        "label": "4 of spades"
      }
    ],
    "preflop": {
      "label": "AKs",
      "ev4x": 1.6583264053227311,
      "ev3x": 1.317433759139855,
      "evCheck": 0.9867402297055493,
      "optimalAction": "raise4x",
      "margin": 0.6715861756171818,
      "flopRaiseFrequency": 0.8682142857142857,
      "riverFoldFrequency": 0.023436349562951916
    },
    "examples": [
      {
        "label": "AA",
        "ev4x": 3.6010726380495988,
        "ev3x": 2.8969983720247803,
        "evCheck": 2.1929241059807616,
        "optimalAction": "raise4x",
        "margin": 1.4081485320688372,
        "flopRaiseFrequency": 1,
        "riverFoldFrequency": 0
      },
      {
        "label": "AKs",
        "ev4x": 1.6583264053227311,
        "ev3x": 1.317433759139855,
        "evCheck": 0.9867402297055493,
        "optimalAction": "raise4x",
        "margin": 0.6715861756171818,
        "flopRaiseFrequency": 0.8682142857142857,
        "riverFoldFrequency": 0.023436349562951916
      },
      {
        "label": "K5o",
        "ev4x": -0.11758213470919712,
        "ev3x": -0.18386159138010777,
        "evCheck": -0.15109970158836616,
        "optimalAction": "raise4x",
        "margin": 0.03351756687916904,
        "flopRaiseFrequency": 0.39464285714285713,
        "riverFoldFrequency": 0.0741150484245502
      },
      {
        "label": "22",
        "ev4x": -0.2878776990023634,
        "ev3x": -0.29455808056962934,
        "evCheck": -0.1794784366918627,
        "optimalAction": "check",
        "margin": 0.10839926231050068,
        "flopRaiseFrequency": 0.14438775510204083,
        "riverFoldFrequency": 0.06359757594064452
      },
      {
        "label": "J7s",
        "ev4x": -0.10660755309312663,
        "ev3x": -0.15310317679553848,
        "evCheck": -0.03444510945128834,
        "optimalAction": "check",
        "margin": 0.07216244364183828,
        "flopRaiseFrequency": 0.4328061224489796,
        "riverFoldFrequency": 0.1542548471747626
      }
    ]
  },
  "elo": {
    "example": {
      "hard": {
        "key": "bj:soft13:vs5",
        "difficulty": 2200,
        "expected": 0.0387,
        "onCorrect": 23,
        "onError": -1
      },
      "easy": {
        "key": "bj:pairT:vs9",
        "difficulty": 1050,
        "expected": 0.9679,
        "onCorrect": 1,
        "onError": -23
      }
    }
  }
};
