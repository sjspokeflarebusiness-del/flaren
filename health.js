/* =========================================================
   FLAREN — Health & Food Guide
   Research-based foods for common conditions + daily routine.
   NOT medical advice. Consult a professional.
   ========================================================= */

(function () {
  "use strict";

  const ROUTINE_KEY = "flaren_routine_v1";

  /* ---------- The 20 conditions from the reference ---------- */
  const CONDITIONS = [
    { id: "diabetes", cat: "Metabolic", name: "Diabetes / Prediabetes",
      fruits: ["Berries", "Apples", "Guavas", "Kiwis"],
      veg: ["Okra", "Spinach", "Broccoli", "Bitter Gourd"],
      why: "High soluble fiber delays stomach emptying and slows carbohydrate breakdown, smoothing out glucose spikes." },
    { id: "obesity", cat: "Metabolic", name: "Obesity / Weight Gain",
      fruits: ["Grapefruit", "Apples", "Watermelon"],
      veg: ["Cucumber", "Cauliflower", "Zucchini"],
      why: "High volume of water and fiber stimulates stretch receptors in the stomach to promote prolonged fullness." },
    { id: "gout", cat: "Metabolic", name: "Gout / High Uric Acid",
      fruits: ["Cherries", "Strawberries", "Blueberries"],
      veg: ["Celery", "Cucumbers", "Bell Peppers"],
      why: "Anthocyanins reduce systemic inflammation and assist renal clearance of uric acid." },
    { id: "bp", cat: "Cardiovascular", name: "High Blood Pressure",
      fruits: ["Bananas", "Pomegranates", "Oranges"],
      veg: ["Beetroot", "Spinach", "Tomatoes", "Celery"],
      why: "High potassium prompts kidneys to excrete sodium. Dietary nitrates convert to nitric oxide, dilating blood vessels." },
    { id: "chol", cat: "Cardiovascular", name: "High Cholesterol",
      fruits: ["Avocados", "Apples", "Pears"],
      veg: ["Eggplant", "Garlic", "Carrots"],
      why: "Soluble pectin binds bile acids in the gut, forcing the liver to pull LDL cholesterol from blood to build new bile." },
    { id: "circ", cat: "Cardiovascular", name: "Poor Circulation / Vein Health",
      fruits: ["Citrus fruits", "Grapes", "Blackberries"],
      veg: ["Kale", "Onions", "Asparagus"],
      why: "Rutin and citrus flavonoids reinforce the structural integrity of capillary walls and reduce fluid leakage." },
    { id: "const", cat: "Digestive", name: "Chronic Constipation",
      fruits: ["Prunes", "Figs", "Pears", "Papaya"],
      veg: ["Sweet Potatoes", "Broccoli", "Carrots"],
      why: "Insoluble cellulose adds bulk to stool, stimulating peristalsis to speed up waste transit." },
    { id: "gerd", cat: "Digestive", name: "Acid Reflux / GERD",
      fruits: ["Bananas", "Melons", "Papaya"],
      veg: ["Fennel", "Cucumbers", "Green Beans"],
      why: "Low-acid foods prevent irritation of the esophageal lining. Papain enzymes aid protein digestion." },
    { id: "ibs", cat: "Digestive", name: "Irritable Bowel / Poor Gut Flora",
      fruits: ["Blueberries", "Bananas", "Kiwis"],
      veg: ["Jerusalem Artichokes", "Garlic", "Leeks"],
      why: "Inulin acts as a prebiotic substrate, feeding beneficial gut bacteria to strengthen the mucosal barrier." },
    { id: "inflam", cat: "Immunological", name: "Chronic Inflammation",
      fruits: ["Strawberries", "Blackberries", "Tart Cherries"],
      veg: ["Turmeric", "Spinach", "Ginger"],
      why: "Polyphenols neutralize free radicals and suppress inflammatory signaling cascades." },
    { id: "colds", cat: "Immunological", name: "Frequent Colds / Weak Immunity",
      fruits: ["Guavas", "Oranges", "Lemons", "Kiwis"],
      veg: ["Bell Peppers", "Broccoli", "Kale"],
      why: "Ascorbic acid concentrates inside immune cells, enhancing their ability to migrate and destroy pathogens." },
    { id: "allergy", cat: "Immunological", name: "Seasonal Allergies",
      fruits: ["Apples", "Citrus Fruits", "Pineapples"],
      veg: ["Onions", "Capers", "Sweet Potatoes"],
      why: "Quercetin acts as a natural mast-cell stabilizer, curbing the release of histamine." },
    { id: "asthma", cat: "Respiratory", name: "Asthma Support",
      fruits: ["Apples", "Oranges", "Avocado"],
      veg: ["Carrots", "Spinach", "Sweet Potatoes"],
      why: "Beta-carotene converts to Vitamin A, which preserves and repairs thin mucus membranes in airways." },
    { id: "cough", cat: "Respiratory", name: "Chronic Cough / Bronchitis",
      fruits: ["Pineapples", "Pears", "Lemons"],
      veg: ["Radishes", "Ginger", "Garlic"],
      why: "Bromelain breaks down peptide bonds in thick mucus, thinning secretions to make coughing productive." },
    { id: "joint", cat: "Bone & Joint", name: "Osteoarthritis / Joint Pain",
      fruits: ["Papaya", "Oranges", "Raspberries"],
      veg: ["Ginger", "Garlic", "Brussels Sprouts"],
      why: "Sulfur compounds and bioactive gingerols suppress pro-inflammatory pathways in joint tissues." },
    { id: "bones", cat: "Bone & Joint", name: "Osteopenia / Weak Bones",
      fruits: ["Prunes", "Figs", "Kiwis"],
      veg: ["Collard Greens", "Spinach", "Bok Choy"],
      why: "High levels of Vitamin K1 activate osteocalcin, binding calcium tightly into the mineral matrix of bones." },
    { id: "uti", cat: "Excretory / Skin", name: "Urinary Tract Infections (UTIs)",
      fruits: ["Cranberries", "Blueberries"],
      veg: ["Celery", "Parsley", "Cucumbers"],
      why: "A-type proanthocyanidins physically block bacteria from anchoring onto the walls of the bladder." },
    { id: "liver", cat: "Excretory / Skin", name: "Fatty Liver Support",
      fruits: ["Grapefruit", "Avocados", "Lemons"],
      veg: ["Artichokes", "Beetroot", "Brussels Sprouts"],
      why: "Naringenin triggers lipid oxidation pathways, helping clear fat deposits from liver tissue." },
    { id: "eczema", cat: "Excretory / Skin", name: "Eczema / Dry Inflamed Skin",
      fruits: ["Avocados", "Mangoes"],
      veg: ["Sweet Potatoes", "Spinach", "Cucumbers"],
      why: "Vitamin E and essential fats stabilize lipid barriers in the epidermis, preventing water loss." },
    { id: "amd", cat: "Neurological", name: "Age-Related Macular Degeneration",
      fruits: ["Blueberries", "Kiwis", "Oranges"],
      veg: ["Spinach", "Kale", "Corn"],
      why: "Lutein and zeaxanthin accumulate inside the retina to absorb damaging blue light waves." },
    { id: "memory", cat: "Neurological", name: "Cognitive Decline / Poor Memory",
      fruits: ["Blueberries", "Blackberries", "Grapes"],
      veg: ["Spinach", "Broccoli", "Beetroot"],
      why: "Flavonoids cross the blood-brain barrier, stimulating cellular pathways that improve memory." }
  ];

  /* ---------- Daily routine (for healthy people) ---------- */
  const DAILY_ROUTINE = [
    { id: "water", label: "Drink 6–8 glasses of water", icon: "💧" },
    { id: "fruits", label: "Eat 2 servings of fruit", icon: "🍎" },
    { id: "veg", label: "Eat 3 servings of vegetables", icon: "🥕" },
    { id: "exercise", label: "20+ minutes of movement", icon: "🏃" },
    { id: "sleep", label: "7–8 hours of sleep", icon: "😴" },
    { id: "noharm", label: "No smoking, no excess alcohol", icon: "🚭" }
  ];

  /* ---------- storage ---------- */
  function loadRoutine() {
    try {
      const raw = localStorage.getItem(ROUTINE_KEY);
      return raw ? JSON.parse(raw) : { date: "", done: {}, streak: 0, history: [] };
    } catch { return { date: "", done: {}, streak: 0, history: [] }; }
  }
  function saveRoutine() {
    localStorage.setItem(ROUTINE_KEY, JSON.stringify(routine));
    try {
      const st = JSON.parse(localStorage.getItem("flaren_v1") || "{}");
      st.routine = routine;
      localStorage.setItem("flaren_v1", JSON.stringify(st));
      if (typeof window.__flarenSaveData === "function") window.__flarenSaveData();
    } catch {}
  }

  let routine = loadRoutine();
  let currentCategory = "All";
  let currentSearch = "";

  function pad(n) { return String(n).padStart(2, "0"); }
  function todayKey() {
    const d = new Date();
    return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
  }
  function escapeHTML(str) {
    return String(str).replaceAll("&","&amp;").replaceAll("<","&lt;").replaceAll(">","&gt;")
      .replaceAll('"',"&quot;").replaceAll("'","&#039;");
  }

  function rollDay() {
    const k = todayKey();
    if (routine.date === k) return;
    const prev = routine.date;
    if (prev) {
      const complete = DAILY_ROUTINE.every(r => routine.done[r.id]);
      routine.history.push({ date: prev, complete });
      if (routine.history.length > 90) routine.history = routine.history.slice(-90);
      if (complete) routine.streak = (routine.streak || 0) + 1;
      else routine.streak = 0;
    }
    routine.date = k;
    routine.done = {};
    saveRoutine();
  }

  function routineComplete() {
    return DAILY_ROUTINE.every(r => routine.done[r.id]);
  }

  function render(el) {
    rollDay();
    draw(el);
  }
  function stop() {}

  function draw(el) {
    const categories = ["All", ...new Set(CONDITIONS.map(c => c.cat))];
    const filtered = CONDITIONS.filter(c => {
      const matchCat = currentCategory === "All" || c.cat === currentCategory;
      const matchSearch = !currentSearch || c.name.toLowerCase().includes(currentSearch);
      return matchCat && matchSearch;
    });

    el.innerHTML = `
      <header class="topbar">
        <div>
          <h2>Health 🥗</h2>
          <p>Foods that help. A daily routine. Honest streaks.</p>
        </div>
      </header>

      <!-- SAFETY DISCLAIMER -->
      <div class="health-disclaimer">
        <span class="health-disclaimer-icon">🩺</span>
        <div>
          <strong>Consult a professional first.</strong>
          <p>This guide is educational. It is not medical advice. Talk to a doctor or nutritionist before changing your diet, especially if you have a medical condition.</p>
        </div>
      </div>

      <!-- DAILY ROUTINE -->
      <div class="health-block">
        <div class="health-block-head">
          <h3>Daily Health Routine</h3>
          <div class="health-block-streak">${routine.streak || 0} <span>day streak</span></div>
        </div>
        <p class="health-block-sub">For everyone. No condition needed. Just the basics.</p>

        <div class="routine-list">
          ${DAILY_ROUTINE.map(r => {
            const done = !!routine.done[r.id];
            return `
              <button class="routine-item ${done ? "done" : ""}" data-routine="${r.id}">
                <span class="routine-icon">${r.icon}</span>
                <span class="routine-label">${escapeHTML(r.label)}</span>
                <span class="routine-check">${done ? "✓" : "○"}</span>
              </button>
            `;
          }).join("")}
        </div>

        ${routineComplete() ? `<div class="routine-complete-badge">✓ Today's routine complete</div>` : ""}
      </div>

      <!-- FOODS FOR CONDITIONS -->
      <div class="health-block">
        <div class="health-block-head">
          <h3>Foods for common conditions</h3>
        </div>
        <p class="health-block-sub">20 conditions. What helps. Why it works.</p>

        <input id="healthSearch" type="text" placeholder="Search a condition (e.g. diabetes, blood pressure)..." value="${escapeHTML(currentSearch)}" style="margin-bottom:16px" />

        <div class="health-cats">
          ${categories.map(c => `
            <button class="health-cat ${c === currentCategory ? "active" : ""}" data-cat="${escapeHTML(c)}">${escapeHTML(c)}</button>
          `).join("")}
        </div>

        <div class="health-conditions">
          ${filtered.length === 0 ? `<div class="empty">No matching conditions.</div>` : ""}
          ${filtered.map(c => `
            <div class="health-condition">
              <div class="health-condition-cat">${escapeHTML(c.cat)}</div>
              <h4>${escapeHTML(c.name)}</h4>
              <div class="health-foods">
                <div class="health-foods-row">
                  <span class="health-foods-lbl">🍎 Fruits</span>
                  <div class="health-foods-chips">
                    ${c.fruits.map(f => `<span class="health-chip fruit">${escapeHTML(f)}</span>`).join("")}
                  </div>
                </div>
                <div class="health-foods-row">
                  <span class="health-foods-lbl">🥕 Vegetables</span>
                  <div class="health-foods-chips">
                    ${c.veg.map(v => `<span class="health-chip veg">${escapeHTML(v)}</span>`).join("")}
                  </div>
                </div>
              </div>
              <p class="health-why"><strong>Why it works:</strong> ${escapeHTML(c.why)}</p>
            </div>
          `).join("")}
        </div>
      </div>

      <!-- SAFETY RULES -->
      <div class="health-block">
        <div class="health-block-head">
          <h3>Essential safety rules</h3>
        </div>
        <ol class="health-rules">
          <li><strong>Sugar-to-Fiber Rule.</strong> If managing diabetes alongside high blood pressure, focus heavily on vegetables and choose only low-glycemic fruits (berries, green apples) in strict portions.</li>
          <li><strong>Kidney Warning.</strong> Advanced kidney issues require careful monitoring of high-potassium items like bananas, spinach, avocados.</li>
          <li><strong>Never Stop Medication.</strong> Natural choices support your health. Never stop blood pressure or insulin prescriptions without your physician's explicit instruction.</li>
        </ol>
      </div>
    `;

    const search = $("#healthSearch", el);
    search.addEventListener("input", () => {
      currentSearch = search.value.toLowerCase();
      const caret = search.selectionStart;
      draw(el);
      const ni = $("#healthSearch", el);
      if (ni) { ni.focus(); ni.setSelectionRange(caret, caret); }
    });

    $$(".health-cat", el).forEach(b => b.addEventListener("click", () => {
      currentCategory = b.dataset.cat;
      draw(el);
    }));

    $$("[data-routine]", el).forEach(b => b.addEventListener("click", () => {
      const id = b.dataset.routine;
      if (routine.done[id]) delete routine.done[id];
      else routine.done[id] = true;
      saveRoutine();
      draw(el);
    }));
  }

  window.FlarenHealth = {
    render: render,
    stop: stop
  };
})();
