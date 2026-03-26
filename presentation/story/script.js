function parseCsv(text) {
  const rows = [];
  let row = [];
  let field = "";
  let inQuotes = false;

  for (let i = 0; i < text.length; i += 1) {
    const char = text[i];

    if (char === '"') {
      if (inQuotes && text[i + 1] === '"') {
        field += '"';
        i += 1;
      } else {
        inQuotes = !inQuotes;
      }
      continue;
    }

    if (char === "," && !inQuotes) {
      row.push(field);
      field = "";
      continue;
    }

    if ((char === "\n" || char === "\r") && !inQuotes) {
      if (char === "\r" && text[i + 1] === "\n") {
        i += 1;
      }
      row.push(field);
      rows.push(row);
      row = [];
      field = "";
      continue;
    }

    field += char;
  }

  if (field.length > 0 || row.length > 0) {
    row.push(field);
    rows.push(row);
  }

  const headers = rows.shift() || [];
  if (headers.length === 0) {
    return [];
  }

  headers[0] = headers[0].replace(/^\uFEFF/, "");

  return rows
    .filter((candidate) => candidate.some((value) => value !== ""))
    .map((candidate) => Object.fromEntries(headers.map((header, index) => [header, candidate[index] || ""])));
}

function formatPValue(value) {
  const number = Number(value);
  if (!Number.isFinite(number)) {
    return "NA";
  }
  if (number === 0) {
    return "0";
  }
  if (number < 0.001) {
    return number.toExponential(2);
  }
  if (number < 0.01) {
    return number.toFixed(4);
  }
  return number.toFixed(3);
}

function formatNumber(value) {
  const number = Number(value);
  if (!Number.isFinite(number)) {
    return "NA";
  }
  if (Math.abs(number) >= 10 || Number.isInteger(number)) {
    return number.toFixed(0);
  }
  return number.toFixed(2);
}

function formatFraction(value) {
  const number = Number(value);
  if (!Number.isFinite(number)) {
    return "NA";
  }
  return number.toFixed(2);
}

function flagText(value) {
  return value === "TRUE" ? "Yes" : "No";
}

function basename(path) {
  return String(path || "").split("/").pop();
}

function escapeHtml(value) {
  return String(value)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;");
}

function interpretApobecPatient(stats) {
  if (stats.hasStrong && stats.hasMultiple) {
    return "Several focal candidates, including at least one stronger enrichment signal.";
  }
  if (stats.hasStrong) {
    return "Contains a stronger candidate, but not a broad multi-sample pattern.";
  }
  if (stats.hasMultiple) {
    return "Repeated candidate enrichment across several sample-type combinations.";
  }
  return "A limited candidate signal that remains focal and patient-specific.";
}

function buildApobecStats(rows) {
  const grouped = new Map();

  rows.forEach((row) => {
    const patient = row.PatientID;
    const current = grouped.get(patient) || {
      patient,
      candidateCount: 0,
      sampleSet: new Set(),
      bestP: Number.POSITIVE_INFINITY,
      maxOr: Number.NEGATIVE_INFINITY,
      hasStrong: false,
      hasMultiple: false
    };

    current.candidateCount += 1;
    current.sampleSet.add(row.Sample);
    current.bestP = Math.min(current.bestP, Number(row.NoSoft_Fisher_p));
    current.maxOr = Math.max(current.maxOr, Number(row.NoSoft_WG_APOBEC_Enrichment));
    current.hasStrong = current.hasStrong || Number(row.NoSoft_WG_APOBEC_Enrichment) >= 10;

    grouped.set(patient, current);
  });

  grouped.forEach((value, key) => {
    value.sampleCount = value.sampleSet.size;
    value.hasMultiple = value.candidateCount >= 3;
    value.interpretation = interpretApobecPatient(value);
    grouped.set(key, value);
  });

  return grouped;
}

const dynamicsRows = [
  { patient: "6003", persistentPairs: 1, staticPairs: 1, smallPairs: 0, largePairs: 0, fromCloud: 0, novel: 0 },
  { patient: "6004", persistentPairs: 34, staticPairs: 28, smallPairs: 3, largePairs: 3, fromCloud: 23, novel: 210 },
  { patient: "6005", persistentPairs: 32, staticPairs: 31, smallPairs: 1, largePairs: 0, fromCloud: 0, novel: 1 },
  { patient: "6007", persistentPairs: 22, staticPairs: 20, smallPairs: 2, largePairs: 0, fromCloud: 1, novel: 1 },
  { patient: "6009", persistentPairs: 11, staticPairs: 11, smallPairs: 0, largePairs: 0, fromCloud: 0, novel: 0 },
  { patient: "6020", persistentPairs: 3, staticPairs: 3, smallPairs: 0, largePairs: 0, fromCloud: 0, novel: 0 },
  { patient: "6021", persistentPairs: 21, staticPairs: 20, smallPairs: 0, largePairs: 1, fromCloud: 5, novel: 22 }
];

const mappingExplorerSteps = [
  {
    kicker: "Competitive recall",
    title: "Competitive mapping and dominant-type recall",
    intro:
      "QC-passed reads are first mapped against a broad HPV reference collection so that every read can compete for its best-fitting type rather than being forced onto a single arbitrary backbone.",
    blocks: [
      {
        heading: "What enters",
        text: "All cleaned reads from the specimen are aligned with Bowtie2 against the combined HPV reference library."
      },
      {
        heading: "Hard filters",
        text: "Type support is kept only when the L1 region passes strict breadth and depth checks: MapQ >= 20, BaseQ >= 20, L1 breadth > 95%, and mean L1 depth >= 5X."
      },
      {
        heading: "Why it matters",
        text: "This step suppresses cross-mapping from conserved regions and defines the dominant type set that deserves backbone reconstruction."
      }
    ],
    note:
      "This is a recall step, not yet an evolutionary step. Its job is to identify the true infection background before subtype-level interpretation begins."
  },
  {
    kicker: "Consensus rebuild",
    title: "Sample-specific consensus reconstruction",
    intro:
      "For each dominant type, reads are remapped to that type reference and a strict reference-guided consensus is built to represent the actual patient-carried genomic backbone.",
    blocks: [
      {
        heading: "Consensus logic",
        text: "High-confidence major variation is folded back into the type reference, while low-coverage blind zones are masked with N."
      },
      {
        heading: "Why not de novo only",
        text: "The point here is not novelty discovery alone; it is coordinate normalization so that T1 and T2 are compared on the same strain-aware scaffold."
      },
      {
        heading: "Output",
        text: "A patient- and type-specific whole-genome consensus that absorbs background divergence and sharply reduces pseudo-SNP inflation."
      }
    ],
    note:
      "Without this reconstruction step, natural subtype distance can be misread as fresh longitudinal mutation."
  },
  {
    kicker: "Precision remapping",
    title: "Precision remapping and LoFreq iSNV calling",
    intro:
      "Reads are remapped back to the sample-specific consensus and LoFreq is used to recover very low-frequency SNVs once the major background differences have already been absorbed.",
    blocks: [
      {
        heading: "Callable evidence",
        text: "Only well-supported positions are allowed to contribute to downstream allele-frequency interpretation and APOBEC statistics."
      },
      {
        heading: "Standing variation record",
        text: "Low-frequency T1 iSNVs become the standing-variation archive against which T2 fixed differences can be tested."
      },
      {
        heading: "Biological payoff",
        text: "This is the step that lets the project distinguish clonal succession from genuinely new sequence change."
      }
    ],
    note:
      "At this stage, a T2 consensus shift is no longer just a visual sequence change: it becomes a testable population-genetic event."
  }
];

const longitudinalModelData = [
  {
    kicker: "Pair design",
    title: "Pair definition and stringent QC",
    intro:
      "The analysis begins by extracting only persistent same-site pairs from the 7 longitudinal patients. In practice, the site-matched longitudinal design is anchored on the only two repeatedly trackable skin sites in this subset, Pc and Ra, and then filtered so that L1 is compared under genuinely high-confidence conditions.",
    blocks: [
      {
        heading: "Pair design",
        text: "A pair is retained only if the same patient, the same HPV type, and the same anatomical site are present at both timepoints; in this subset, the repeated trackable sites are Pc and Ra."
      },
      {
        heading: "QC threshold",
        text: "Both T1 and T2 must show mean L1 depth above 100 and complete L1 coverage so that apparent absence is not just a coverage artifact."
      },
      {
        heading: "Resulting cohort",
        text: "The strict filter reduces 246 candidate persistent pairs to 124 defensible L1 comparisons, making the later interpretation much cleaner."
      }
    ],
    note:
      "This step turns the longitudinal question from a broad ecological comparison into a controlled same-site molecular test."
  },
  {
    kicker: "Backbone layer",
    title: "Backbone comparison asks whether dominant L1 truly changed",
    intro:
      "The first analytical layer compares the T1 and T2 L1 backbone directly. This asks whether the dominant L1 sequence is still the same, not yet whether the low-frequency cloud is stable.",
    blocks: [
      {
        heading: "Backbone-static majority",
        text: "Among the 124 QC-pass pairs, 114 show no L1 backbone change at all, indicating strong consensus-level stability."
      },
      {
        heading: "Mutated minority",
        text: "Only 10 pairs show any L1 backbone mutation, and these split into 6 small-change pairs (1 to 10 mutations) and 4 large-change pairs (>10 mutations)."
      },
      {
        heading: "Interpretation",
        text: "Small from-cloud-rich events are the best candidates for standing-variation fixation, whereas large novel-dominated events are more consistent with subtype replacement or background switching."
      }
    ],
    note:
      "Under this site-matched design, true L1 backbone change is the exception rather than the rule."
  },
  {
    kicker: "Cloud layer",
    title: "Static backbone does not mean a static low-frequency cloud",
    intro:
      "The 114 backbone-static pairs are then reopened at iSNV resolution. This second layer asks whether identical dominant consensus can still conceal substantial movement in minor-allele composition.",
    blocks: [
      {
        heading: "Fully quiet pairs are rare",
        text: "Only 24 of 114 static pairs lack any L1 iSNV cloud at both timepoints, which is the strictest definition of true molecular silence."
      },
      {
        heading: "Cloud mobility dominates",
        text: "The remaining 90 static pairs split into 7 stable clouds, 36 shifting clouds, and 47 complete-turnover clouds."
      },
      {
        heading: "Interpretation",
        text: "Consensus-level stasis therefore coexists with substantial cloud-level mobility, implying that minor variants can appear, disappear, and reshuffle even when the dominant backbone is unchanged."
      }
    ],
    note:
      "The most important conclusion here is not just that many pairs are static, but that most static pairs are static only at the backbone level."
  }
];

const recombRules = [
  "Patient-internal donor shortlist only",
  "Sliding windows across each child genome",
  "Local identity plus local query coverage review",
  "Follow coherent winner blocks, not noisy alternation",
  "Manual priority goes to nonfragmented mosaic-like patterns",
  "Interpret as screening, not definitive proof"
];

const apobecCandidatesCsv = `PatientID,Sample,Type,NoSoft_SNVs,NoSoft_TargetMutSites,NoSoft_BackgroundMutSites,TargetSites,BackgroundSites,NoSoft_WG_APOBEC_Enrichment,NoSoft_Fisher_p
6008,Met1731,HPV57,241,20,76,441,3490,2.17,0.004068937857414339
6002,Met1783,HPV21,51,7,6,593,2606,5.12,0.004421166864999845
6008,Met1727,HPV120,37,6,5,412,1944,5.64,0.005786145780611822
6021,Met2101,HPV38,22,5,3,543,2469,7.2,0.006487362353314597
6004,Met1793,HPV120,25,5,3,528,2371,7.11,0.006789256549748919
6004,Met1790,HPV112,13,3,0,516,2162,29.48,0.007119918078740727
6012,Met1097,HPV131,8,3,0,562,2102,26.3,0.009349185261522053
6004,Met2088,HPV-mSK_030,8,5,3,543,2155,6.28,0.010586149151939714
6008,Met1727,HPV76,31,7,9,529,2604,3.92,0.010620468748672984
6008,Met1727,HPV3,50,6,12,407,3159,4.08,0.01192115690010752
6012,Met1094,HPV36,258,22,61,540,2737,1.89,0.012775033902919536
6010,Met1743,HPV3,11,2,0,408,3153,38.79,0.013098832861609733
6010,Met1745,HPV3,5,2,0,398,3065,38.66,0.013179350976645588
6010,Met1739,HPV-mSK_223,20,4,2,536,2217,7.49,0.015278567761527315
6010,Met1743,HPV15,134,14,28,537,2298,2.21,0.01842613063136821
6005,Met1795,HPV-mSK_185,8,4,2,571,2088,6.62,0.02178611337354656
6004,Met1791,HPV120,21,4,3,527,2373,5.82,0.023760966167244754
6003,Met1788,HPV36,216,20,58,545,2727,1.78,0.02716723905154226
6008,Met1731,HPV76,30,6,9,456,2268,3.43,0.027577348603769713
6009,Met1807,HPV-mSK_234,4,3,1,570,2152,8.85,0.030856506621318867
6004,Met1791,HPV-mSK_227,2,2,0,479,2177,22.8,0.032469142105022795
6010,Met1085,HPV-mSK_015,54,7,9,554,2083,2.99,0.03382853524717389
6015,Met1831,HPV-mSK_104,2,2,0,517,2241,21.74,0.03508400924482666
6010,Met1745,HPV20,5,2,0,602,2607,21.71,0.03514527019944594
6004,Met1790,HPV-mSK_026,3,2,0,544,2310,21.29,0.03627797096246596
6010,Met1745,HPV-mSK_224,5,2,0,527,2214,21.07,0.03690938093343181
6004,Met2089,HPV173,2,2,0,526,2157,20.57,0.03837652099004163
6001,Met2053,HPV-mSK_207,86,10,17,492,1870,2.3,0.038427690938739135
6020,Met1860,HPV-mSK_130,21,3,2,494,2377,6.77,0.03856018551520984
6015,Met1833,HPV-mSK_103,3,2,0,525,2136,20.41,0.03886548389015578
6010,Met1084,HPV-mSK_015,25,4,3,554,2083,4.86,0.0392499342796957
6010,Met1749,HPV-mSK_014,3,2,0,527,2115,20.13,0.03972785754009341
6015,Met1831,HPV-mSK_107,5,2,0,529,2120,20.1,0.039818936405245295
6012,Met1765,HPV209,27,4,4,450,2035,4.55,0.04028575360255883
6010,Met1739,HPV-mSK_237,15,4,4,504,2277,4.54,0.040420498160484465
6008,Met1727,HPV-mSK_005,14,3,2,442,2065,6.57,0.04116836632323044
6012,Met1775,HPV38,9,3,2,497,2315,6.55,0.04146225044369552
6015,Met1831,HPV-mSK_102,2,2,0,539,2094,19.48,0.041844106310122066
6014,Met1824,HPV-mSK_117,50,9,18,504,2268,2.33,0.042916071430156806
6015,Met1830,HPV-mSK_085,4,2,0,554,2104,19.05,0.043379881868531096
6014,Met1824,HPV-mSK_156,57,9,15,549,2100,2.36,0.04371264054272662
6021,Met1867,HPV38,13,3,2,543,2469,6.39,0.04375065271135746
6021,Met1871,HPV38,15,3,2,543,2469,6.39,0.04375065271135746
6005,Met2090,HPV-mSK_212,14,5,6,531,2199,3.53,0.04492732188419698
6009,Met1808,HPV-mSK_049,3,2,0,554,2028,18.36,0.04597170948611615
6012,Met1765,HPV-mSK_196,16,3,2,530,2325,6.17,0.04733220442104039
6010,Met1749,HPV-mSK_242,4,2,0,567,2010,17.78,0.04834362504422607
6010,Met1088,HPV98,24,4,5,516,2561,4.08,0.04873639440545741
6010,Met1743,HPV-mSK_242,2,2,0,557,1961,17.66,0.04886422840948883
6006,Met1798,HPV8,141,11,26,478,2228,2.04,0.049005886656455624
6006,Met1799,HPV-mSK_232,41,4,4,517,2169,4.22,0.049378222282946874`;

const apobecOverviewCsv = `PatientID,Candidates,Samples,HeightInches,PNG,PDF
6001,1,1,6.5,/Users/ruixuan/Library/CloudStorage/OneDrive-TheUniversityofHongKong-Connect/HPV_evo/temp/re-mapping_results_v3/apobec_softclip_rescreen/patient_overview_figures/patient_6001_apobec_overview.png,/Users/ruixuan/Library/CloudStorage/OneDrive-TheUniversityofHongKong-Connect/HPV_evo/temp/re-mapping_results_v3/apobec_softclip_rescreen/patient_overview_figures/patient_6001_apobec_overview.pdf
6002,1,1,6.5,/Users/ruixuan/Library/CloudStorage/OneDrive-TheUniversityofHongKong-Connect/HPV_evo/temp/re-mapping_results_v3/apobec_softclip_rescreen/patient_overview_figures/patient_6002_apobec_overview.png,/Users/ruixuan/Library/CloudStorage/OneDrive-TheUniversityofHongKong-Connect/HPV_evo/temp/re-mapping_results_v3/apobec_softclip_rescreen/patient_overview_figures/patient_6002_apobec_overview.pdf
6003,1,1,6.5,/Users/ruixuan/Library/CloudStorage/OneDrive-TheUniversityofHongKong-Connect/HPV_evo/temp/re-mapping_results_v3/apobec_softclip_rescreen/patient_overview_figures/patient_6003_apobec_overview.png,/Users/ruixuan/Library/CloudStorage/OneDrive-TheUniversityofHongKong-Connect/HPV_evo/temp/re-mapping_results_v3/apobec_softclip_rescreen/patient_overview_figures/patient_6003_apobec_overview.pdf
6004,7,5,20.750000000000004,/Users/ruixuan/Library/CloudStorage/OneDrive-TheUniversityofHongKong-Connect/HPV_evo/temp/re-mapping_results_v3/apobec_softclip_rescreen/patient_overview_figures/patient_6004_apobec_overview.png,/Users/ruixuan/Library/CloudStorage/OneDrive-TheUniversityofHongKong-Connect/HPV_evo/temp/re-mapping_results_v3/apobec_softclip_rescreen/patient_overview_figures/patient_6004_apobec_overview.pdf
6005,2,2,7.24,/Users/ruixuan/Library/CloudStorage/OneDrive-TheUniversityofHongKong-Connect/HPV_evo/temp/re-mapping_results_v3/apobec_softclip_rescreen/patient_overview_figures/patient_6005_apobec_overview.png,/Users/ruixuan/Library/CloudStorage/OneDrive-TheUniversityofHongKong-Connect/HPV_evo/temp/re-mapping_results_v3/apobec_softclip_rescreen/patient_overview_figures/patient_6005_apobec_overview.pdf
6006,2,2,7.24,/Users/ruixuan/Library/CloudStorage/OneDrive-TheUniversityofHongKong-Connect/HPV_evo/temp/re-mapping_results_v3/apobec_softclip_rescreen/patient_overview_figures/patient_6006_apobec_overview.png,/Users/ruixuan/Library/CloudStorage/OneDrive-TheUniversityofHongKong-Connect/HPV_evo/temp/re-mapping_results_v3/apobec_softclip_rescreen/patient_overview_figures/patient_6006_apobec_overview.pdf
6008,6,2,17.04,/Users/ruixuan/Library/CloudStorage/OneDrive-TheUniversityofHongKong-Connect/HPV_evo/temp/re-mapping_results_v3/apobec_softclip_rescreen/patient_overview_figures/patient_6008_apobec_overview.png,/Users/ruixuan/Library/CloudStorage/OneDrive-TheUniversityofHongKong-Connect/HPV_evo/temp/re-mapping_results_v3/apobec_softclip_rescreen/patient_overview_figures/patient_6008_apobec_overview.pdf
6009,2,2,7.24,/Users/ruixuan/Library/CloudStorage/OneDrive-TheUniversityofHongKong-Connect/HPV_evo/temp/re-mapping_results_v3/apobec_softclip_rescreen/patient_overview_figures/patient_6009_apobec_overview.png,/Users/ruixuan/Library/CloudStorage/OneDrive-TheUniversityofHongKong-Connect/HPV_evo/temp/re-mapping_results_v3/apobec_softclip_rescreen/patient_overview_figures/patient_6009_apobec_overview.pdf
6010,13,7,36.29,/Users/ruixuan/Library/CloudStorage/OneDrive-TheUniversityofHongKong-Connect/HPV_evo/temp/re-mapping_results_v3/apobec_softclip_rescreen/patient_overview_figures/patient_6010_apobec_overview.png,/Users/ruixuan/Library/CloudStorage/OneDrive-TheUniversityofHongKong-Connect/HPV_evo/temp/re-mapping_results_v3/apobec_softclip_rescreen/patient_overview_figures/patient_6010_apobec_overview.pdf
6012,5,4,15.43,/Users/ruixuan/Library/CloudStorage/OneDrive-TheUniversityofHongKong-Connect/HPV_evo/temp/re-mapping_results_v3/apobec_softclip_rescreen/patient_overview_figures/patient_6012_apobec_overview.png,/Users/ruixuan/Library/CloudStorage/OneDrive-TheUniversityofHongKong-Connect/HPV_evo/temp/re-mapping_results_v3/apobec_softclip_rescreen/patient_overview_figures/patient_6012_apobec_overview.pdf
6014,2,1,6.82,/Users/ruixuan/Library/CloudStorage/OneDrive-TheUniversityofHongKong-Connect/HPV_evo/temp/re-mapping_results_v3/apobec_softclip_rescreen/patient_overview_figures/patient_6014_apobec_overview.png,/Users/ruixuan/Library/CloudStorage/OneDrive-TheUniversityofHongKong-Connect/HPV_evo/temp/re-mapping_results_v3/apobec_softclip_rescreen/patient_overview_figures/patient_6014_apobec_overview.pdf
6015,5,3,15.01,/Users/ruixuan/Library/CloudStorage/OneDrive-TheUniversityofHongKong-Connect/HPV_evo/temp/re-mapping_results_v3/apobec_softclip_rescreen/patient_overview_figures/patient_6015_apobec_overview.png,/Users/ruixuan/Library/CloudStorage/OneDrive-TheUniversityofHongKong-Connect/HPV_evo/temp/re-mapping_results_v3/apobec_softclip_rescreen/patient_overview_figures/patient_6015_apobec_overview.pdf
6020,1,1,6.5,/Users/ruixuan/Library/CloudStorage/OneDrive-TheUniversityofHongKong-Connect/HPV_evo/temp/re-mapping_results_v3/apobec_softclip_rescreen/patient_overview_figures/patient_6020_apobec_overview.png,/Users/ruixuan/Library/CloudStorage/OneDrive-TheUniversityofHongKong-Connect/HPV_evo/temp/re-mapping_results_v3/apobec_softclip_rescreen/patient_overview_figures/patient_6020_apobec_overview.pdf
6021,3,3,10.11,/Users/ruixuan/Library/CloudStorage/OneDrive-TheUniversityofHongKong-Connect/HPV_evo/temp/re-mapping_results_v3/apobec_softclip_rescreen/patient_overview_figures/patient_6021_apobec_overview.png,/Users/ruixuan/Library/CloudStorage/OneDrive-TheUniversityofHongKong-Connect/HPV_evo/temp/re-mapping_results_v3/apobec_softclip_rescreen/patient_overview_figures/patient_6021_apobec_overview.pdf`;

const smallDiffCsv = `PatientID,Type,Site,Pair,BackboneMutTotal,FromCloudSNV,NovelSNV,Interpretation,PNG
6004,HPV-mSK_028,Pc,Met1791_vs_Met2088,78,13,65,Large novel-dominated shift; more compatible with a different background backbone than with slow within-host accumulation,6004_HPV-mSK_028_Pc_Met1791_vs_Met2088_L1_backbone_v6.png
6004,HPV-mSK_164,Ra,Met1792_vs_Met2089,128,0,128,Extreme large-change pair; best read as background replacement rather than de novo evolution,6004_HPV-mSK_164_Ra_Met1792_vs_Met2089_L1_backbone_v6.png
6004,HPV-mSK_169,Pc,Met1791_vs_Met2088,11,0,11,Borderline large-change event but still entirely novel-weighted,6004_HPV-mSK_169_Pc_Met1791_vs_Met2088_L1_backbone_v6.png
6004,HPV-mSK_227,Pc,Met1791_vs_Met2088,1,0,1,Single-site novel change; small event but not supported by the T1 cloud,6004_HPV-mSK_227_Pc_Met1791_vs_Met2088_L1_backbone_v6.png
6004,HPV22,Pc,Met1791_vs_Met2088,9,9,0,Best standing-variation-fixation style example; all backbone changes are already visible in the T1 cloud,6004_HPV22_Pc_Met1791_vs_Met2088_L1_backbone_v6.png
6004,HPV24,Ra,Met1792_vs_Met2089,6,1,5,Small mixed-origin change with limited from-cloud support,6004_HPV24_Ra_Met1792_vs_Met2089_L1_backbone_v6.png
6005,HPV-mSK_035,Ra,Met1796_vs_Met2091,1,0,1,Single-site novel change; small but not cloud-driven,6005_HPV-mSK_035_Ra_Met1796_vs_Met2091_L1_backbone_v6.png
6007,HPV-mSK_220,Ra,Met2093_vs_Met1077,1,1,0,Minimal from-cloud-supported fixation candidate,6007_HPV-mSK_220_Ra_Met2093_vs_Met1077_L1_backbone_v6.png
6007,HPV120,Pc,Met2092_vs_Met1075,1,0,1,Minimal but novel-only change,6007_HPV120_Pc_Met2092_vs_Met1075_L1_backbone_v6.png
6021,HPV98,Pc,Met1871_vs_Met2101,27,5,22,Large mixed event that still looks too divergent to call gradual de novo evolution,6021_HPV98_Pc_Met1871_vs_Met2101_L1_backbone_v6.png`;

const staticCloudCsv = `PatientID,Type,Site,Pair,CloudClass,T1_iSNV,T2_iSNV,Shared_iSNV,T1_only_iSNV,T2_only_iSNV,Jaccard,Shared_AF_PearsonR,T1_APOBEC_iSNV,T2_APOBEC_iSNV
6003,HPV24,Ra,Met1788_vs_Met2086,Complete turnover,95,0,0,95,0,0.000000,,3,0
6004,HPV-mSK_026,Pc,Met1791_vs_Met2088,No iSNV cloud,0,0,0,0,0,1.000000,,0,0
6004,HPV-mSK_027,Pc,Met1791_vs_Met2088,Shifting cloud,121,39,34,87,5,0.269841,-0.109461,5,2
6004,HPV-mSK_030,Pc,Met1791_vs_Met2088,Complete turnover,0,18,0,0,18,0.000000,,0,1
6004,HPV-mSK_031,Pc,Met1791_vs_Met2088,Complete turnover,0,1,0,0,1,0.000000,,0,1
6004,HPV-mSK_037,Pc,Met1791_vs_Met2088,Complete turnover,18,0,0,18,0,0.000000,,2,0
6004,HPV-mSK_061,Pc,Met1791_vs_Met2088,Complete turnover,37,0,0,37,0,0.000000,,0,0
6004,HPV-mSK_082,Pc,Met1791_vs_Met2088,Complete turnover,0,32,0,0,32,0.000000,,0,4
6004,HPV-mSK_113,Pc,Met1791_vs_Met2088,Complete turnover,6,21,0,6,21,0.000000,,0,2
6004,HPV-mSK_153,Pc,Met1791_vs_Met2088,Complete turnover,0,24,0,0,24,0.000000,,0,1
6004,HPV-mSK_170,Pc,Met1791_vs_Met2088,Shifting cloud,52,27,1,51,26,0.012821,,1,2
6004,HPV-mSK_171,Pc,Met1791_vs_Met2088,Complete turnover,0,18,0,0,18,0.000000,,0,1
6004,HPV-mSK_172,Pc,Met1791_vs_Met2088,Shifting cloud,22,34,7,15,27,0.142857,-0.052599,2,3
6004,HPV-mSK_185,Pc,Met1791_vs_Met2088,Shifting cloud,6,33,6,0,27,0.181818,0.815866,1,2
6004,HPV-mSK_238,Pc,Met1791_vs_Met2088,Stable cloud,1,1,1,0,0,1.000000,,0,0
6004,HPV-mSK_240,Pc,Met1791_vs_Met2088,Complete turnover,4,1,0,4,1,0.000000,,0,0
6004,HPV109,Pc,Met1791_vs_Met2088,Complete turnover,2,0,0,2,0,0.000000,,0,0
6004,HPV112,Pc,Met1791_vs_Met2088,Shifting cloud,166,99,65,101,34,0.325000,0.141004,5,5
6004,HPV120,Pc,Met1791_vs_Met2088,Shifting cloud,31,11,7,24,4,0.200000,0.557432,2,2
6004,HPV147,Pc,Met1791_vs_Met2088,Shifting cloud,38,24,4,34,20,0.068966,0.626947,2,1
6004,HPV8,Pc,Met1791_vs_Met2088,Complete turnover,3,3,0,3,3,0.000000,,0,0
6004,HPV-mSK_026,Ra,Met1792_vs_Met2089,Complete turnover,0,1,0,0,1,0.000000,,0,0
6004,HPV-mSK_063,Ra,Met1792_vs_Met2089,Complete turnover,1,2,0,1,2,0.000000,,1,0
6004,HPV-mSK_169,Ra,Met1792_vs_Met2089,No iSNV cloud,0,0,0,0,0,1.000000,,0,0
6004,HPV-mSK_181,Ra,Met1792_vs_Met2089,Complete turnover,22,0,0,22,0,0.000000,,3,0
6004,HPV120,Ra,Met1792_vs_Met2089,Complete turnover,0,58,0,0,58,0.000000,,0,2
6004,HPV14,Ra,Met1792_vs_Met2089,Complete turnover,0,1,0,0,1,0.000000,,0,0
6004,HPV144,Ra,Met1792_vs_Met2089,No iSNV cloud,0,0,0,0,0,1.000000,,0,0
6004,HPV98,Ra,Met1792_vs_Met2089,No iSNV cloud,0,0,0,0,0,1.000000,,0,0
6005,HPV-mSK_034,Pc,Met1795_vs_Met2090,Shifting cloud,6,14,3,3,11,0.176471,-0.588025,1,2
6005,HPV-mSK_035,Pc,Met1795_vs_Met2090,Shifting cloud,42,100,25,17,75,0.213675,0.300415,1,4
6005,HPV-mSK_038,Pc,Met1795_vs_Met2090,Shifting cloud,148,164,88,60,76,0.392857,0.279837,7,7
6005,HPV-mSK_040,Pc,Met1795_vs_Met2090,Shifting cloud,19,6,6,13,0,0.315789,0.682974,2,2
6005,HPV-mSK_070,Pc,Met1795_vs_Met2090,Complete turnover,26,0,0,26,0,0.000000,,2,0
6005,HPV-mSK_084,Pc,Met1795_vs_Met2090,Shifting cloud,44,47,19,25,28,0.263889,0.662442,0,1
6005,HPV-mSK_113,Pc,Met1795_vs_Met2090,No iSNV cloud,0,0,0,0,0,1.000000,,0,0
6005,HPV-mSK_135,Pc,Met1795_vs_Met2090,Shifting cloud,53,152,53,0,99,0.348684,0.296216,5,10
6005,HPV-mSK_143,Pc,Met1795_vs_Met2090,Complete turnover,11,0,0,11,0,0.000000,,0,0
6005,HPV-mSK_147,Pc,Met1795_vs_Met2090,Shifting cloud,3,69,3,0,66,0.043478,0.982074,0,4
6005,HPV-mSK_164,Pc,Met1795_vs_Met2090,Shifting cloud,4,125,1,3,124,0.007812,,0,5
6005,HPV-mSK_182,Pc,Met1795_vs_Met2090,Shifting cloud,128,145,87,41,58,0.467742,0.034696,7,7
6005,HPV-mSK_185,Pc,Met1795_vs_Met2090,Shifting cloud,31,14,14,17,0,0.451613,0.904285,2,1
6005,HPV-mSK_194,Pc,Met1795_vs_Met2090,Shifting cloud,6,71,6,0,65,0.084507,0.913073,0,5
6005,HPV-mSK_212,Pc,Met1795_vs_Met2090,Shifting cloud,4,34,4,0,30,0.117647,0.910536,1,3
6005,HPV-mSK_232,Pc,Met1795_vs_Met2090,Shifting cloud,39,141,29,10,112,0.192053,0.430708,2,6
6005,HPV112,Pc,Met1795_vs_Met2090,Stable cloud,189,164,159,30,5,0.819588,0.767527,11,12
6005,HPV119,Pc,Met1795_vs_Met2090,Stable cloud,151,179,112,39,67,0.513761,0.126103,4,7
6005,HPV122,Pc,Met1795_vs_Met2090,Shifting cloud,25,58,2,23,56,0.024691,1.000000,0,1
6005,HPV123,Pc,Met1795_vs_Met2090,Complete turnover,17,0,0,17,0,0.000000,,1,0
6005,HPV179,Pc,Met1795_vs_Met2090,Shifting cloud,13,45,13,0,32,0.288889,0.904428,1,3
6005,HPV20,Pc,Met1795_vs_Met2090,Shifting cloud,3,41,2,1,39,0.047619,1.000000,1,5
6005,HPV38,Pc,Met1795_vs_Met2090,Shifting cloud,66,139,66,0,73,0.474820,-0.067156,4,7
6005,HPV5,Pc,Met1795_vs_Met2090,Complete turnover,2,0,0,2,0,0.000000,,0,0
6005,HPV-mSK_028,Ra,Met1796_vs_Met2091,Shifting cloud,13,48,13,0,35,0.270833,0.962813,1,3
6005,HPV-mSK_034,Ra,Met1796_vs_Met2091,Shifting cloud,2,10,2,0,8,0.200000,1.000000,0,0
6005,HPV-mSK_037,Ra,Met1796_vs_Met2091,Complete turnover,2,0,0,2,0,0.000000,,1,0
6005,HPV-mSK_143,Ra,Met1796_vs_Met2091,No iSNV cloud,0,0,0,0,0,1.000000,,0,0
6005,HPV-mSK_182,Ra,Met1796_vs_Met2091,No iSNV cloud,0,0,0,0,0,1.000000,,0,0
6005,HPV-mSK_212,Ra,Met1796_vs_Met2091,Complete turnover,13,8,0,13,8,0.000000,,0,0
6005,HPV12,Ra,Met1796_vs_Met2091,Complete turnover,14,2,0,14,2,0.000000,,0,0
6007,HPV-mSK_136,Pc,Met2092_vs_Met1075,No iSNV cloud,0,0,0,0,0,1.000000,,0,0
6007,HPV-mSK_139,Pc,Met2092_vs_Met1075,Complete turnover,1,9,0,1,9,0.000000,,0,0
6007,HPV-mSK_153,Pc,Met2092_vs_Met1075,No iSNV cloud,0,0,0,0,0,1.000000,,0,0
6007,HPV-mSK_208,Pc,Met2092_vs_Met1075,No iSNV cloud,0,0,0,0,0,1.000000,,0,0
6007,HPV-mSK_222,Pc,Met2092_vs_Met1075,Complete turnover,4,7,0,4,7,0.000000,,0,1
6007,HPV104,Pc,Met2092_vs_Met1075,No iSNV cloud,0,0,0,0,0,1.000000,,0,0
6007,HPV129,Pc,Met2092_vs_Met1075,Complete turnover,0,3,0,0,3,0.000000,,0,0
6007,HPV20,Pc,Met2092_vs_Met1075,Complete turnover,14,9,0,14,9,0.000000,,0,0
6007,HPV201,Pc,Met2092_vs_Met1075,No iSNV cloud,0,0,0,0,0,1.000000,,0,0
6007,HPV-mSK_114,Ra,Met2093_vs_Met1077,Complete turnover,0,16,0,0,16,0.000000,,0,1
6007,HPV-mSK_147,Ra,Met2093_vs_Met1077,No iSNV cloud,0,0,0,0,0,1.000000,,0,0
6007,HPV-mSK_153,Ra,Met2093_vs_Met1077,Complete turnover,0,1,0,0,1,0.000000,,0,0
6007,HPV-mSK_234,Ra,Met2093_vs_Met1077,Complete turnover,0,1,0,0,1,0.000000,,0,0
6007,HPV-mSK_237,Ra,Met2093_vs_Met1077,Complete turnover,2,0,0,2,0,0.000000,,0,0
6007,HPV-mSK_247,Ra,Met2093_vs_Met1077,Complete turnover,0,1,0,0,1,0.000000,,0,1
6007,HPV201,Ra,Met2093_vs_Met1077,Complete turnover,0,1,0,0,1,0.000000,,0,0
6007,HPV23,Ra,Met2093_vs_Met1077,Complete turnover,0,1,0,0,1,0.000000,,0,0
6007,HPV24,Ra,Met2093_vs_Met1077,Complete turnover,17,9,0,17,9,0.000000,,1,0
6007,HPV38,Ra,Met2093_vs_Met1077,Stable cloud,7,7,5,2,2,0.555556,0.752973,0,0
6007,HPV80,Ra,Met2093_vs_Met1077,Complete turnover,24,0,0,24,0,0.000000,,2,0
6009,HPV-mSK_044,Pc,Met1808_vs_Met2095,Shifting cloud,24,42,14,10,28,0.269231,0.747595,1,1
6009,HPV-mSK_049,Pc,Met1808_vs_Met2095,No iSNV cloud,0,0,0,0,0,1.000000,,0,0
6009,HPV-mSK_050,Pc,Met1808_vs_Met2095,No iSNV cloud,0,0,0,0,0,1.000000,,0,0
6009,HPV-mSK_067,Pc,Met1808_vs_Met2095,No iSNV cloud,0,0,0,0,0,1.000000,,0,0
6009,HPV-mSK_126,Pc,Met1808_vs_Met2095,Complete turnover,4,0,0,4,0,0.000000,,0,0
6009,HPV-mSK_177,Pc,Met1808_vs_Met2095,No iSNV cloud,0,0,0,0,0,1.000000,,0,0
6009,HPV-mSK_050,Ra,Met1810_vs_Met2096,Shifting cloud,82,124,50,32,74,0.320513,0.677255,3,2
6009,HPV-mSK_125,Ra,Met1810_vs_Met2096,No iSNV cloud,0,0,0,0,0,1.000000,,0,0
6009,HPV111,Ra,Met1810_vs_Met2096,Complete turnover,0,64,0,0,64,0.000000,,0,4
6009,HPV164,Ra,Met1810_vs_Met2096,Complete turnover,51,0,0,51,0,0.000000,,1,0
6009,HPV175,Ra,Met1810_vs_Met2096,Complete turnover,1,1,0,1,1,0.000000,,0,0
6020,HPV-mSK_142,Ra,Met1865_vs_Met2099,Complete turnover,0,1,0,0,1,0.000000,,0,0
6020,HPV-mSK_219,Ra,Met1865_vs_Met2099,Shifting cloud,116,31,31,85,0,0.267241,0.221834,4,1
6020,HPV-mSK_235,Ra,Met1865_vs_Met2099,No iSNV cloud,0,0,0,0,0,1.000000,,0,0
6021,HPV-mSK_147,Pc,Met1871_vs_Met2101,Complete turnover,0,19,0,0,19,0.000000,,0,1
6021,HPV-mSK_148,Pc,Met1871_vs_Met2101,Complete turnover,11,0,0,11,0,0.000000,,1,0
6021,HPV12,Pc,Met1871_vs_Met2101,Shifting cloud,21,6,4,17,2,0.173913,0.999984,1,0
6021,HPV122,Pc,Met1871_vs_Met2101,Shifting cloud,123,65,40,83,25,0.270270,0.943596,3,2
6021,HPV149,Pc,Met1871_vs_Met2101,No iSNV cloud,0,0,0,0,0,1.000000,,0,0
6021,HPV22,Pc,Met1871_vs_Met2101,Complete turnover,7,13,0,7,13,0.000000,,1,1
6021,HPV24,Pc,Met1871_vs_Met2101,No iSNV cloud,0,0,0,0,0,1.000000,,0,0
6021,HPV37,Pc,Met1871_vs_Met2101,Shifting cloud,9,23,9,0,14,0.391304,0.980203,0,0
6021,HPV38,Pc,Met1871_vs_Met2101,Shifting cloud,16,36,12,4,24,0.300000,0.897301,0,1
6021,HPV-mSK_148,Ra,Met1873_vs_Met2102,No iSNV cloud,0,0,0,0,0,1.000000,,0,0
6021,HPV-mSK_150,Ra,Met1873_vs_Met2102,Stable cloud,6,4,4,2,0,0.666667,0.987046,2,2
6021,HPV-mSK_220,Ra,Met1873_vs_Met2102,Complete turnover,66,15,0,66,15,0.000000,,1,2
6021,HPV107,Ra,Met1873_vs_Met2102,Complete turnover,52,22,0,52,22,0.000000,,4,2
6021,HPV12,Ra,Met1873_vs_Met2102,Shifting cloud,1,51,1,0,50,0.019608,,0,5
6021,HPV149,Ra,Met1873_vs_Met2102,Stable cloud,1,1,1,0,0,1.000000,,0,0
6021,HPV201,Ra,Met1873_vs_Met2102,No iSNV cloud,0,0,0,0,0,1.000000,,0,0
6021,HPV22,Ra,Met1873_vs_Met2102,Shifting cloud,8,77,8,0,69,0.103896,0.853210,0,3
6021,HPV24,Ra,Met1873_vs_Met2102,No iSNV cloud,0,0,0,0,0,1.000000,,0,0
6021,HPV37,Ra,Met1873_vs_Met2102,Shifting cloud,63,7,5,58,2,0.076923,0.921753,0,0
6021,HPV38,Ra,Met1873_vs_Met2102,Stable cloud,91,85,70,21,15,0.660377,0.872080,4,4`;

const ringOverviewCsv = `PatientID,Date,PNG
6000,2010-09-27,Patient6000_2010-09-27_ring_linkage.png
6001,2011-02-15,Patient6001_2011-02-15_ring_linkage.png
6002,2011-02-16,Patient6002_2011-02-16_ring_linkage.png
6003,2011-02-16,Patient6003_2011-02-16_ring_linkage.png
6003,2016-07-06,Patient6003_2016-07-06_ring_linkage.png
6004,2011-04-06,Patient6004_2011-04-06_ring_linkage.png
6004,2016-09-13,Patient6004_2016-09-13_ring_linkage.png
6005,2011-07-19,Patient6005_2011-07-19_ring_linkage.png
6005,2013-07-08,Patient6005_2013-07-08_ring_linkage.png
6006,2012-02-29,Patient6006_2012-02-29_ring_linkage.png
6007,2013-03-12,Patient6007_2013-03-12_ring_linkage.png
6007,2013-05-29,Patient6007_2013-05-29_ring_linkage.png
6008,2013-06-11,Patient6008_2013-06-11_ring_linkage.png
6009,2013-07-11,Patient6009_2013-07-11_ring_linkage.png
6009,2013-08-06,Patient6009_2013-08-06_ring_linkage.png
6010,2014-03-31,Patient6010_2014-03-31_ring_linkage.png
6011,2014-04-07,Patient6011_2014-04-07_ring_linkage.png
6012,2014-06-20,Patient6012_2014-06-20_ring_linkage.png
6013,2014-11-12,Patient6013_2014-11-12_ring_linkage.png
6014,2015-01-21,Patient6014_2015-01-21_ring_linkage.png
6015,2015-01-16,Patient6015_2015-01-16_ring_linkage.png
6016,2015-02-17,Patient6016_2015-02-17_ring_linkage.png
6017,2015-03-12,Patient6017_2015-03-12_ring_linkage.png
6018,2015-08-27,Patient6018_2015-08-27_ring_linkage.png
6019,2015-05-07,Patient6019_2015-05-07_ring_linkage.png
6020,2015-10-05,Patient6020_2015-10-05_ring_linkage.png
6020,2015-11-25,Patient6020_2015-11-25_ring_linkage.png
6021,2015-11-23,Patient6021_2015-11-23_ring_linkage.png
6021,2016-07-13,Patient6021_2016-07-13_ring_linkage.png
6022,2016-11-02,Patient6022_2016-11-02_ring_linkage.png
6023,2016-11-01,Patient6023_2016-11-01_ring_linkage.png
6024,2016-04-27,Patient6024_2016-04-27_ring_linkage.png
6025,2016-08-10,Patient6025_2016-08-10_ring_linkage.png
6026,2016-10-26,Patient6026_2016-10-26_ring_linkage.png`;

const staticCloudPatientRows = [
  { patient: "6003", staticPairs: 1, noCloud: 0, stableCloud: 0, shiftingCloud: 0, completeTurnover: 1 },
  { patient: "6004", staticPairs: 28, noCloud: 4, stableCloud: 1, shiftingCloud: 7, completeTurnover: 16 },
  { patient: "6005", staticPairs: 31, noCloud: 3, stableCloud: 2, shiftingCloud: 19, completeTurnover: 7 },
  { patient: "6007", staticPairs: 20, noCloud: 6, stableCloud: 1, shiftingCloud: 0, completeTurnover: 13 },
  { patient: "6009", staticPairs: 11, noCloud: 5, stableCloud: 0, shiftingCloud: 2, completeTurnover: 4 },
  { patient: "6020", staticPairs: 3, noCloud: 1, stableCloud: 0, shiftingCloud: 1, completeTurnover: 1 },
  { patient: "6021", staticPairs: 20, noCloud: 5, stableCloud: 3, shiftingCloud: 7, completeTurnover: 5 }
];

const apobecCandidateRows = parseCsv(apobecCandidatesCsv);
const apobecOverviewRows = parseCsv(apobecOverviewCsv);
const smallDiffRows = parseCsv(smallDiffCsv);
const staticCloudRows = parseCsv(staticCloudCsv);
const ringOverviewRows = parseCsv(ringOverviewCsv);

setupScrollSpy();
setupNavProgress();
setupLightbox();
setupExplorers();
renderDynamicsTable();
renderStaticCloudTable();
renderStaticPairViewer();
renderRecombRules();
renderSmallDiffTable();
renderApobecTable();
renderApobecGallery();
renderRingGallery();
renderLongitudinalOverviewGallery();

function setupScrollSpy() {
  const majorSections = [...document.querySelectorAll("[data-major-section]")];
  const majorLinks = [...document.querySelectorAll("[data-major-link]")];
  const detailSections = [...document.querySelectorAll("[data-detail-section]")];
  const detailLinks = [...document.querySelectorAll("[data-detail-link]")];
  const header = document.querySelector(".site-header");

  function setActiveLink(sections, links, sectionAttr, linkAttr, offsetExtra = 0) {
    if (sections.length === 0 || links.length === 0) {
      return;
    }

    const headerOffset = header?.offsetHeight || 0;
    const marker = window.scrollY + headerOffset + offsetExtra;
    let activeSection = sections[0];

    sections.forEach((section) => {
      if (section.offsetTop <= marker) {
        activeSection = section;
      }
    });

    links.forEach((link) => {
      link.classList.toggle("active", link.dataset[linkAttr] === activeSection.dataset[sectionAttr]);
    });
  }

  function updateActiveSections() {
    setActiveLink(majorSections, majorLinks, "majorSection", "majorLink", 120);
    setActiveLink(detailSections, detailLinks, "detailSection", "detailLink", 160);
  }

  updateActiveSections();
  window.addEventListener("scroll", updateActiveSections, { passive: true });
  window.addEventListener("resize", updateActiveSections);
  window.addEventListener("hashchange", updateActiveSections);
}

function setupNavProgress() {
  const progressFill = document.getElementById("navProgressFill");
  if (!progressFill) {
    return;
  }

  function updateProgress() {
    const scrollTop = window.scrollY || window.pageYOffset;
    const scrollRange = document.documentElement.scrollHeight - window.innerHeight;
    const ratio = scrollRange > 0 ? Math.min(Math.max(scrollTop / scrollRange, 0), 1) : 0;
    progressFill.style.height = `${ratio * 100}%`;
  }

  updateProgress();
  window.addEventListener("scroll", updateProgress, { passive: true });
  window.addEventListener("resize", updateProgress);
}

function setupLightbox() {
  const lightbox = document.getElementById("lightbox");
  const image = document.getElementById("lightboxImage");
  const caption = document.getElementById("lightboxCaption");
  const closeButton = document.getElementById("lightboxClose");

  if (!lightbox || !image || !caption || !closeButton) {
    return;
  }

  function closeLightbox() {
    lightbox.hidden = true;
    image.removeAttribute("src");
    image.alt = "";
    caption.textContent = "";
  }

  document.addEventListener("click", (event) => {
    const target = event.target;
    if (!(target instanceof HTMLElement)) {
      return;
    }

    if (target.matches("[data-lightbox]")) {
      const img = target;
      const figure = img.closest("figure");
      const figureCaption = figure?.querySelector("figcaption")?.textContent?.trim();
      const customCaption = img.getAttribute("data-lightbox-caption");

      image.src = img.getAttribute("src") || "";
      image.alt = img.getAttribute("alt") || "";
      caption.textContent = customCaption || figureCaption || "";
      lightbox.hidden = false;
      return;
    }

    if (target === lightbox || target === closeButton) {
      closeLightbox();
    }
  });

  document.addEventListener("keydown", (event) => {
    if (event.key === "Escape" && !lightbox.hidden) {
      closeLightbox();
    }
  });
}

function setupExplorers() {
  setupExplorer({
    buttonSelector: "[data-mapping-step]",
    data: mappingExplorerSteps,
    panelId: "mappingStepPanel",
    indexAttribute: "mappingStep",
    render: renderExplorerPanel
  });

  setupExplorer({
    buttonSelector: "[data-model-index]",
    data: longitudinalModelData,
    panelId: "longitudinalModelPanel",
    indexAttribute: "modelIndex",
    render: renderExplorerPanel
  });
}

function setupExplorer({ buttonSelector, data, panelId, indexAttribute, render }) {
  const buttons = [...document.querySelectorAll(buttonSelector)];
  const panel = document.getElementById(panelId);

  if (buttons.length === 0 || !panel || data.length === 0) {
    return;
  }

  function setActive(index) {
    const item = data[index];
    if (!item) {
      return;
    }

    buttons.forEach((button) => {
      button.classList.toggle("active", Number(button.dataset[indexAttribute]) === index);
    });

    panel.innerHTML = render(item);
  }

  buttons.forEach((button) => {
    button.addEventListener("click", () => {
      setActive(Number(button.dataset[indexAttribute]));
    });
  });

  setActive(0);
}

function renderExplorerPanel(item) {
  const blocks = item.blocks
    .map(
      (block) => `
        <article class="explorer-block">
          <h5>${escapeHtml(block.heading)}</h5>
          <p>${escapeHtml(block.text)}</p>
        </article>
      `
    )
    .join("");

  return `
    <p class="explorer-kicker">${escapeHtml(item.kicker)}</p>
    <h4>${escapeHtml(item.title)}</h4>
    <p class="explorer-intro">${escapeHtml(item.intro)}</p>
    <div class="explorer-grid">${blocks}</div>
    <div class="explorer-note">${escapeHtml(item.note)}</div>
  `;
}

function renderDynamicsTable() {
  const container = document.getElementById("dynamicsTable");
  if (!container) {
    return;
  }

  const rows = dynamicsRows
    .map(
      (row) => `
        <tr>
          <td>${escapeHtml(row.patient)}</td>
          <td>${row.persistentPairs}</td>
          <td>${row.staticPairs}</td>
          <td>${row.smallPairs}</td>
          <td>${row.largePairs}</td>
          <td>${row.fromCloud}</td>
          <td>${row.novel}</td>
        </tr>
      `
    )
    .join("");

  container.innerHTML = `
    <table class="paper-table">
      <thead>
        <tr>
          <th scope="col">Patient</th>
          <th scope="col">Persistent same-site pairs</th>
          <th scope="col">Backbone-static</th>
          <th scope="col">Small mutated pairs (1-10)</th>
          <th scope="col">Large mutated pairs (&gt;10)</th>
          <th scope="col">From-cloud SNVs</th>
          <th scope="col">Novel SNVs</th>
        </tr>
      </thead>
      <tbody>${rows}</tbody>
    </table>
  `;
}

function renderStaticCloudTable() {
  const container = document.getElementById("staticCloudTable");
  if (!container) {
    return;
  }

  const rows = staticCloudPatientRows
    .map(
      (row) => `
        <tr>
          <td>${escapeHtml(row.patient)}</td>
          <td>${row.staticPairs}</td>
          <td>${row.noCloud}</td>
          <td>${row.stableCloud}</td>
          <td>${row.shiftingCloud}</td>
          <td>${row.completeTurnover}</td>
        </tr>
      `
    )
    .join("");

  container.innerHTML = `
    <table class="paper-table">
      <thead>
        <tr>
          <th scope="col">Patient</th>
          <th scope="col">Backbone-static pairs</th>
          <th scope="col">No iSNV cloud</th>
          <th scope="col">Stable cloud</th>
          <th scope="col">Shifting cloud</th>
          <th scope="col">Complete turnover</th>
        </tr>
      </thead>
      <tbody>${rows}</tbody>
    </table>
  `;
}

function getCloudClassMeta(label) {
  const value = String(label || "");

  if (value === "No iSNV cloud") {
    return {
      slug: "no-cloud",
      summary:
        "No L1 polymorphic sites were detected at either timepoint. This is the clearest form of molecular stasis: the backbone is unchanged and the low-frequency cloud is absent.",
      emphasis: "True cloud-free stasis"
    };
  }

  if (value === "Stable cloud") {
    return {
      slug: "stable",
      summary:
        "The same backbone carries a largely retained low-frequency cloud across time. Minor variants are present, but much of the cloud remains shared between T1 and T2.",
      emphasis: "Backbone-static, cloud-retained"
    };
  }

  if (value === "Shifting cloud") {
    return {
      slug: "shifting",
      summary:
        "The backbone remains fixed, but the low-frequency cloud is reweighted. A shared component persists, yet many variants are gained or lost between T1 and T2.",
      emphasis: "Backbone-static, cloud-reweighted"
    };
  }

  return {
    slug: "turnover",
    summary:
      "The dominant L1 backbone is unchanged, but the detectable low-frequency cloud does not overlap across time. This is the clearest example of consensus stasis masking cloud-level turnover.",
    emphasis: "Backbone-static, cloud-replaced"
  };
}

function buildStaticCloudFigureName(row) {
  return `${row.PatientID}_${row.Type}_${row.Site}_${row.Pair}_clarity_final.png`;
}

function renderStaticPairViewer() {
  const patientNav = document.getElementById("staticPairPatientNav");
  const sampleNav = document.getElementById("staticPairSampleNav");
  const viewer = document.getElementById("staticPairViewer");

  if (!patientNav || !sampleNav || !viewer) {
    return;
  }

  if (staticCloudRows.length === 0) {
    viewer.innerHTML = `<p class="fine-print">Backbone-static pair viewer unavailable.</p>`;
    return;
  }

  const grouped = new Map();
  staticCloudRows.forEach((row) => {
    const patient = row.PatientID;
    if (!grouped.has(patient)) {
      grouped.set(patient, []);
    }
    grouped.get(patient).push(row);
  });

  const patients = [...grouped.keys()].sort((a, b) => Number(a) - Number(b));
  const activeIndexByPatient = new Map();
  let activePatient =
    patients.find((patient) => (grouped.get(patient) || []).some((row) => row.CloudClass !== "No iSNV cloud")) ||
    patients[0] ||
    null;

  patients.forEach((patient) => {
    const patientRows = grouped.get(patient) || [];
    const plottedIndex = patientRows.findIndex((row) => row.CloudClass !== "No iSNV cloud");
    activeIndexByPatient.set(patient, plottedIndex >= 0 ? plottedIndex : 0);
  });

  function renderPatientNav() {
    patientNav.innerHTML = patients
      .map((patient) => {
        const patientRows = grouped.get(patient) || [];
        const isActive = patient === activePatient ? " active" : "";
        return `
          <button class="gallery-jump${isActive}" type="button" data-static-patient="${escapeHtml(patient)}">
            Pt ${escapeHtml(patient)} (${patientRows.length})
          </button>
        `;
      })
      .join("");

    patientNav.querySelectorAll("[data-static-patient]").forEach((button) => {
      button.addEventListener("click", () => {
        activePatient = button.dataset.staticPatient;
        renderPatientNav();
        renderSampleNav();
        renderViewer();
      });
    });
  }

  function renderSampleNav() {
    const patientRows = grouped.get(activePatient) || [];
    sampleNav.innerHTML = patientRows
      .map((row, index) => {
        const isActive = index === (activeIndexByPatient.get(activePatient) || 0) ? " active" : "";
        return `
          <button class="gallery-jump gallery-jump-small${isActive}" type="button" data-static-sample="${index}">
            ${escapeHtml(row.Type)} ${escapeHtml(row.Site)}
          </button>
        `;
      })
      .join("");

    sampleNav.querySelectorAll("[data-static-sample]").forEach((button) => {
      button.addEventListener("click", () => {
        activeIndexByPatient.set(activePatient, Number(button.dataset.staticSample));
        renderSampleNav();
        renderViewer();
      });
    });
  }

  function renderViewer() {
    const patientRows = grouped.get(activePatient) || [];
    const activeIndex = Math.min(activeIndexByPatient.get(activePatient) || 0, patientRows.length - 1);
    const row = patientRows[activeIndex];

    if (!row) {
      viewer.innerHTML = `<p class="fine-print">Backbone-static sample view unavailable.</p>`;
      return;
    }

    const meta = getCloudClassMeta(row.CloudClass);
    const t1 = Number(row.T1_iSNV);
    const t2 = Number(row.T2_iSNV);
    const noCloud = meta.slug === "no-cloud";
    const figureName = buildStaticCloudFigureName(row);
    const figureMarkup = noCloud
      ? `
        <div class="static-quiet-stage">
          <div class="static-quiet-icon">0</div>
          <p>No pair-level cloud plot was generated because both timepoints remained free of detectable L1 polymorphic sites.</p>
        </div>
      `
      : `
        <figure class="static-figure">
          <div class="static-figure-stage">
            <img
              src="./assets/static_cloud_clarity/${escapeHtml(figureName)}"
              alt="Static cloud clarity plot for patient ${escapeHtml(row.PatientID)} ${escapeHtml(row.Type)} ${escapeHtml(row.Site)}"
              loading="eager"
              data-lightbox
              data-lightbox-caption="Patient ${escapeHtml(row.PatientID)} ${escapeHtml(row.Type)} ${escapeHtml(row.Site)} static-cloud clarity plot."
            />
          </div>
          <figcaption>
            Pair-level clarity plot for ${escapeHtml(row.Type)} at ${escapeHtml(row.Site)}. The backbone is unchanged across time; the panel shows whether the low-frequency cloud is retained, shifted, or replaced.
          </figcaption>
        </figure>
      `;
    const interpretation = noCloud
      ? "This pair belongs to the 24 truly silent cases: no L1 polymorphic sites are detected at either T1 or T2."
      : "This pair belongs to the 90 cloud-bearing static cases: the backbone is fixed, but the low-frequency cloud still shows a visible longitudinal pattern.";

    viewer.innerHTML = `
      <article class="gallery-card viewer-card static-viewer-card">
        <div class="gallery-card-head">
          <div>
            <p class="card-kicker">Patient ${escapeHtml(row.PatientID)} | ${escapeHtml(row.Type)} | ${escapeHtml(row.Site)}</p>
            <h4>Backbone-static pair</h4>
          </div>
          <div class="gallery-meta">${escapeHtml(row.Pair)}</div>
        </div>
        <div class="static-viewer-body">
          <div class="static-viewer-summary">
            <span class="cloud-class-pill cloud-class-${escapeHtml(meta.slug)}">${escapeHtml(row.CloudClass)}</span>
            <p class="static-viewer-lede">${escapeHtml(meta.emphasis)}</p>
            <p class="static-viewer-text">${escapeHtml(meta.summary)}</p>
          </div>
          ${figureMarkup}
          <div class="callout note-callout static-viewer-note"><strong>Interpretation:</strong> ${escapeHtml(interpretation)}</div>
        </div>
      </article>
    `;
  }

  renderPatientNav();
  renderSampleNav();
  renderViewer();
}

function renderRecombRules() {
  const container = document.getElementById("recombRules");
  if (!container) {
    return;
  }

  container.innerHTML = recombRules.map((rule) => `<span class="rule-chip">${escapeHtml(rule)}</span>`).join("");
}

function renderSmallDiffTable() {
  const container = document.getElementById("smallDiffTable");
  if (!container) {
    return;
  }

  if (smallDiffRows.length === 0) {
    container.innerHTML = `<p class="fine-print">Backbone-change summary table unavailable.</p>`;
    return;
  }

  const body = smallDiffRows
    .map(
      (row) => `
        <tr>
          <td>${escapeHtml(row.PatientID)}</td>
          <td>${escapeHtml(row.Type)}</td>
          <td>${escapeHtml(row.Site)}</td>
          <td>${escapeHtml(row.Pair)}</td>
          <td>${escapeHtml(row.BackboneMutTotal)}</td>
          <td>${escapeHtml(row.FromCloudSNV)}</td>
          <td>${escapeHtml(row.NovelSNV)}</td>
          <td>${escapeHtml(row.Interpretation)}</td>
        </tr>
      `
    )
    .join("");

  container.innerHTML = `
    <table class="paper-table">
      <thead>
        <tr>
          <th scope="col">Patient</th>
          <th scope="col">Type</th>
          <th scope="col">Site</th>
          <th scope="col">Pair</th>
          <th scope="col">Backbone changes</th>
          <th scope="col">From-cloud</th>
          <th scope="col">Novel</th>
          <th scope="col">Interpretation</th>
        </tr>
      </thead>
      <tbody>${body}</tbody>
    </table>
  `;
}

function renderApobecTable() {
  const container = document.getElementById("apobecTable");
  if (!container) {
    return;
  }

  if (apobecCandidateRows.length === 0) {
    container.innerHTML = `<p class="fine-print">APOBEC candidate table unavailable.</p>`;
    return;
  }

  const body = apobecCandidateRows
    .map(
      (row) => `
        <tr>
          <td>${escapeHtml(row.PatientID)}</td>
          <td>${escapeHtml(row.Sample)}</td>
          <td>${escapeHtml(row.Type)}</td>
          <td>${escapeHtml(row.NoSoft_SNVs)}</td>
          <td>${escapeHtml(row.NoSoft_TargetMutSites)}</td>
          <td>${escapeHtml(row.NoSoft_BackgroundMutSites)}</td>
          <td>${escapeHtml(row.TargetSites)}</td>
          <td>${escapeHtml(row.BackgroundSites)}</td>
          <td>${formatNumber(row.NoSoft_WG_APOBEC_Enrichment)}</td>
          <td>${formatPValue(row.NoSoft_Fisher_p)}</td>
        </tr>
      `
    )
    .join("");
 
  container.innerHTML = `
    <table class="paper-table">
      <thead>
        <tr>
          <th scope="col">Patient</th>
          <th scope="col">Sample</th>
          <th scope="col">Type</th>
          <th scope="col">No-soft SNVs</th>
          <th scope="col">Target mutations</th>
          <th scope="col">Background mutations</th>
          <th scope="col">Target sites</th>
          <th scope="col">Background sites</th>
          <th scope="col">OR</th>
          <th scope="col">p-value</th>
        </tr>
      </thead>
      <tbody>${body}</tbody>
    </table>
  `;

  renderApobecPatientSummary(apobecCandidateRows);
}

function renderApobecPatientSummary(candidateRows) {
  const container = document.getElementById("apobecPatientSummary");
  if (!container) {
    return;
  }

  const grouped = buildApobecStats(candidateRows);
  const rows = [...grouped.values()]
    .sort((a, b) => Number(a.patient) - Number(b.patient))
    .map(
      (row) => `
        <tr>
          <td>${escapeHtml(row.patient)}</td>
          <td>${row.candidateCount}</td>
          <td>${row.sampleCount}</td>
          <td>${formatPValue(row.bestP)}</td>
          <td>${formatNumber(row.maxOr)}</td>
          <td>${escapeHtml(row.interpretation)}</td>
        </tr>
      `
    )
    .join("");

  container.innerHTML = `
    <table class="paper-table">
      <thead>
        <tr>
          <th scope="col">Patient</th>
          <th scope="col">Candidates (p < 0.05)</th>
          <th scope="col">Samples represented</th>
          <th scope="col">Best p-value</th>
          <th scope="col">Strongest OR</th>
          <th scope="col">Interpretation</th>
        </tr>
      </thead>
      <tbody>${rows}</tbody>
    </table>
  `;
}

function renderApobecGallery() {
  const navContainer = document.getElementById("apobecGalleryNav");
  const galleryContainer = document.getElementById("apobecGallery");

  if (!navContainer || !galleryContainer) {
    return;
  }

  if (apobecOverviewRows.length === 0) {
    galleryContainer.innerHTML = `<p class="fine-print">APOBEC summary figures unavailable.</p>`;
    return;
  }

  const stats = buildApobecStats(apobecCandidateRows);
  const rows = apobecOverviewRows.sort((a, b) => Number(a.PatientID) - Number(b.PatientID));
  let activePatient = rows[0]?.PatientID || null;

  function renderNav() {
    navContainer.innerHTML = rows
      .map((row) => {
        const isActive = row.PatientID === activePatient ? " active" : "";
        return `
          <button class="gallery-jump${isActive}" type="button" data-apobec-patient="${escapeHtml(row.PatientID)}">
            Pt ${escapeHtml(row.PatientID)} (${escapeHtml(row.Candidates)})
          </button>
        `;
      })
      .join("");

    navContainer.querySelectorAll("[data-apobec-patient]").forEach((button) => {
      button.addEventListener("click", () => {
        activePatient = button.dataset.apobecPatient;
        renderNav();
        renderViewer();
      });
    });
  }

  function renderViewer() {
    const row = rows.find((item) => item.PatientID === activePatient);
    if (!row) {
      galleryContainer.innerHTML = `<p class="fine-print">APOBEC summary figure unavailable.</p>`;
      return;
    }

    const fileName = basename(row.PNG);
    const patient = escapeHtml(row.PatientID);
    const candidates = escapeHtml(row.Candidates);
    const samples = escapeHtml(row.Samples);
    const patientStats = stats.get(row.PatientID) || {
      bestP: null,
      maxOr: null,
      interpretation: "Overview panel available; candidate summary unavailable."
    };

    galleryContainer.innerHTML = `
      <article class="gallery-card viewer-card" id="apobec-patient-${patient}">
        <div class="gallery-card-head">
          <div>
            <p class="card-kicker">Patient ${patient}</p>
            <h4>APOBEC summary</h4>
          </div>
          <div class="gallery-meta">${candidates} candidate(s) | ${samples} sample(s)</div>
        </div>
        <figure>
          <img
            src="./assets/${escapeHtml(fileName)}"
            alt="Patient ${patient} APOBEC summary figure"
            loading="eager"
            data-lightbox
            data-lightbox-caption="Patient ${patient} APOBEC summary. Best raw p = ${formatPValue(patientStats.bestP)}. Strongest OR = ${formatNumber(patientStats.maxOr)}."
          />
          <figcaption>
            Patient ${patient} overview figure from the no-softclip rescreen. Candidate count: ${candidates}. Sample
            count: ${samples}. Best raw p: ${formatPValue(patientStats.bestP)}. Strongest OR:
            ${formatNumber(patientStats.maxOr)}. ${escapeHtml(patientStats.interpretation)}
          </figcaption>
        </figure>
      </article>
    `;
  }

  renderNav();
  renderViewer();
}

function renderRingGallery() {
  const navContainer = document.getElementById("ringGalleryNav");
  const galleryContainer = document.getElementById("ringGallery");

  if (!navContainer || !galleryContainer) {
    return;
  }

  if (ringOverviewRows.length === 0) {
    galleryContainer.innerHTML = `<p class="fine-print">Ring plots unavailable.</p>`;
    return;
  }

  const rows = [...ringOverviewRows].sort((a, b) => {
    const patientDelta = Number(a.PatientID) - Number(b.PatientID);
    if (patientDelta !== 0) {
      return patientDelta;
    }
    return String(a.Date).localeCompare(String(b.Date));
  });

  const grouped = new Map();
  rows.forEach((row) => {
    const patient = row.PatientID;
    if (!grouped.has(patient)) {
      grouped.set(patient, []);
    }
    grouped.get(patient).push(row);
  });
  const patients = [...grouped.keys()].sort((a, b) => Number(a) - Number(b));
  let activePatient = patients[0] || null;
  const activeDateByPatient = new Map(patients.map((patient) => [patient, 0]));

  function renderNav() {
    navContainer.innerHTML = patients
      .map((patient) => {
        const patientRows = grouped.get(patient) || [];
        const isActive = patient === activePatient ? " active" : "";
        return `
          <button class="gallery-jump${isActive}" type="button" data-ring-patient="${escapeHtml(patient)}">
            Pt ${escapeHtml(patient)} (${patientRows.length})
          </button>
        `;
      })
      .join("");

    navContainer.querySelectorAll("[data-ring-patient]").forEach((button) => {
      button.addEventListener("click", () => {
        activePatient = button.dataset.ringPatient;
        renderNav();
        renderViewer();
      });
    });
  }

  function renderViewer() {
    const patientRows = grouped.get(activePatient) || [];
    if (patientRows.length === 0) {
      galleryContainer.innerHTML = `<p class="fine-print">Ring plots unavailable.</p>`;
      return;
    }

    const activeDateIndex = Math.min(activeDateByPatient.get(activePatient) || 0, patientRows.length - 1);
    const activeRow = patientRows[activeDateIndex];
    const fileName = basename(activeRow.PNG);

    const dateNav =
      patientRows.length > 1
        ? `
          <div class="gallery-subnav" aria-label="Ring plot date selector">
            ${patientRows
              .map((row, index) => {
                const isActive = index === activeDateIndex ? " active" : "";
                return `
                  <button class="gallery-jump gallery-jump-small${isActive}" type="button" data-ring-date="${index}">
                    ${escapeHtml(row.Date)}
                  </button>
                `;
              })
              .join("")}
          </div>
        `
        : "";

    galleryContainer.innerHTML = `
      <article class="gallery-card viewer-card ring-viewer-card" id="ring-patient-${escapeHtml(activePatient)}">
        <div class="gallery-card-head">
          <div>
            <p class="card-kicker">Patient ${escapeHtml(activePatient)}</p>
            <h4>Site-sharing ring plot</h4>
          </div>
          <div class="gallery-meta">${patientRows.length} timepoint(s)</div>
        </div>
        ${dateNav}
        <figure class="ring-viewer-figure">
          <div class="ring-viewer-stage">
            <img
              src="./assets/${escapeHtml(fileName)}"
              alt="Patient ${escapeHtml(activePatient)} ring linkage plot at ${escapeHtml(activeRow.Date)}"
              loading="eager"
              data-lightbox
              data-lightbox-caption="Patient ${escapeHtml(activePatient)} ring linkage plot (${escapeHtml(activeRow.Date)})."
            />
          </div>
          <figcaption>
            Patient ${escapeHtml(activePatient)} | Date: ${escapeHtml(activeRow.Date)}. Blue links indicate identical
            consensus across sites; orange links indicate near-identical consensus within the current SNP threshold.
          </figcaption>
        </figure>
      </article>
    `;

    galleryContainer.querySelectorAll("[data-ring-date]").forEach((button) => {
      button.addEventListener("click", () => {
        activeDateByPatient.set(activePatient, Number(button.dataset.ringDate));
        renderViewer();
      });
    });
  }

  renderNav();
  renderViewer();
}

function renderLongitudinalOverviewGallery() {
  const navContainer = document.getElementById("longitudinalOverviewNav");
  const galleryContainer = document.getElementById("longitudinalOverviewGallery");

  if (!navContainer || !galleryContainer) {
    return;
  }

  if (smallDiffRows.length === 0) {
    galleryContainer.innerHTML = `<p class="fine-print">Backbone-change plots unavailable.</p>`;
    return;
  }
  let activePairIndex = 0;

  function renderNav() {
    navContainer.innerHTML = smallDiffRows
      .map((row, index) => {
        const isActive = index === activePairIndex ? " active" : "";
        return `
          <button class="gallery-jump${isActive}" type="button" data-l1-mut-index="${index}">
            ${escapeHtml(row.PatientID)} ${escapeHtml(row.Type)} ${escapeHtml(row.Site)}
          </button>
        `;
      })
      .join("");

    navContainer.querySelectorAll("[data-l1-mut-index]").forEach((button) => {
      button.addEventListener("click", () => {
        activePairIndex = Number(button.dataset.l1MutIndex);
        renderNav();
        renderViewer();
      });
    });
  }

  function renderViewer() {
    const row = smallDiffRows[activePairIndex];
    if (!row) {
      galleryContainer.innerHTML = `<p class="fine-print">Backbone-change plot unavailable.</p>`;
      return;
    }

    galleryContainer.innerHTML = `
      <article class="gallery-card viewer-card" id="longitudinal-patient-${escapeHtml(row.PatientID)}-${activePairIndex}">
        <div class="gallery-card-head">
          <div>
            <p class="card-kicker">Patient ${escapeHtml(row.PatientID)} | ${escapeHtml(row.Type)} | ${escapeHtml(row.Site)}</p>
            <h4>L1 backbone change map</h4>
          </div>
          <div class="gallery-meta">${escapeHtml(row.BackboneMutTotal)} changes | ${escapeHtml(row.FromCloudSNV)} from-cloud | ${escapeHtml(row.NovelSNV)} novel</div>
        </div>
        <figure>
          <img
            src="./assets/${escapeHtml(row.PNG)}"
            alt="Mutated L1 backbone pair for patient ${escapeHtml(row.PatientID)} ${escapeHtml(row.Type)} ${escapeHtml(row.Site)}"
            loading="eager"
            data-lightbox
            data-lightbox-caption="Patient ${escapeHtml(row.PatientID)} ${escapeHtml(row.Type)} ${escapeHtml(row.Site)}. Backbone changes ${escapeHtml(row.BackboneMutTotal)}, from-cloud ${escapeHtml(row.FromCloudSNV)}, novel ${escapeHtml(row.NovelSNV)}."
          />
          <figcaption>
            ${escapeHtml(row.Pair)}. ${escapeHtml(row.Interpretation)}
          </figcaption>
        </figure>
      </article>
    `;
  }

  renderNav();
  renderViewer();
}
