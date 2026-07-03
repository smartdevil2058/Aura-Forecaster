// Aura Forecast - Application Logic

document.addEventListener("DOMContentLoaded", () => {
    // Application State
    const state = {
        stores: [],
        items: [],
        minDate: "",
        maxDate: "",
        selectedSingleStore: null,
        selectedSingleItem: null,
        selectedTrendStore: null,
        selectedTrendItem: null,
        chartInstance: null
    };

    // DOM Elements
    const elements = {
        loaderOverlay: document.getElementById("loader-overlay"),
        connectionStatus: document.getElementById("txt-connection-status"),
        statusIndicator: document.querySelector(".status-indicator"),
        currentTime: document.getElementById("txt-current-time"),
        
        // Navigation & Titles
        headerTitle: document.getElementById("txt-header-title"),
        headerSubtitle: document.getElementById("txt-header-subtitle"),
        navItems: document.querySelectorAll(".nav-item"),
        tabPanes: document.querySelectorAll(".tab-pane"),
        
        // Stats Cards
        statStores: document.getElementById("txt-stat-stores"),
        statItems: document.getElementById("txt-stat-items"),
        statRange: document.getElementById("txt-stat-range"),
        statDates: document.getElementById("txt-stat-dates"),
        statOil: document.getElementById("txt-stat-oil"),
        
        // Single Predict Form
        formSingle: document.getElementById("form-prediction"),
        inputSingleStore: document.getElementById("input-store-nbr"),
        inputSingleItem: document.getElementById("input-item-nbr"),
        inputSingleDate: document.getElementById("input-date"),
        inputSinglePromo: document.getElementById("input-promotion"),
        btnSingleSubmit: document.getElementById("btn-predict-submit"),
        
        // Autocomplete Lists
        singleStoreList: document.getElementById("store-autocomplete-list"),
        singleItemList: document.getElementById("item-autocomplete-list"),
        trendStoreList: document.getElementById("trend-store-autocomplete-list"),
        trendItemList: document.getElementById("trend-item-autocomplete-list"),
        
        // Single Predict Results
        resultPanel: document.getElementById("prediction-result-panel"),
        resultDisplay: document.querySelector(".result-display"),
        resultPlaceholder: document.querySelector(".result-placeholder"),
        predictedSalesVal: document.getElementById("txt-predicted-sales"),
        resStoreLoc: document.getElementById("txt-res-store-loc"),
        resStoreType: document.getElementById("txt-res-store-type"),
        resItemFam: document.getElementById("txt-res-item-fam"),
        resItemClass: document.getElementById("txt-res-item-class"),
        resDateDay: document.getElementById("txt-res-date-day"),
        resDateHoliday: document.getElementById("txt-res-date-holiday"),
        resOilPrice: document.getElementById("txt-res-oil-price"),
        resPromo: document.getElementById("txt-res-promo"),
        
        // Accordion
        btnAccordion: document.getElementById("btn-toggle-features"),
        accordionBody: document.getElementById("features-accordion-body"),
        featLag1: document.getElementById("feat-lag1"),
        featLag7: document.getElementById("feat-lag7"),
        featRollMean: document.getElementById("feat-roll-mean"),
        featRollMean30: document.getElementById("feat-roll-mean30"),
        featOilDiff: document.getElementById("feat-oil-diff"),
        featWeekend: document.getElementById("feat-weekend"),
        
        // Trend Predict Form
        formTrend: document.getElementById("form-trend"),
        inputTrendStore: document.getElementById("input-trend-store"),
        inputTrendItem: document.getElementById("input-trend-item"),
        inputTrendDate: document.getElementById("input-trend-date"),
        inputTrendPromo: document.getElementById("input-trend-promo"),
        btnTrendSubmit: document.getElementById("btn-trend-submit"),
        
        // Trend Results
        timelineResultsWrap: document.getElementById("timeline-results-wrap"),
        timelineGrid: document.getElementById("timeline-cards-grid"),
        chartTitle: document.getElementById("txt-chart-title"),
        chartSubtitle: document.getElementById("txt-chart-subtitle"),
        
        // Theme Toggle
        themeToggleBtn: document.getElementById("btn-theme-toggle"),
        themeLbl: document.getElementById("txt-theme-lbl"),
        sunIcon: document.querySelector(".sidebar-footer .sun-icon"),
        moonIcon: document.querySelector(".sidebar-footer .moon-icon")
    };

    // Set current date
    const options = { year: 'numeric', month: 'long', day: 'numeric' };
    elements.currentTime.textContent = new Date().toLocaleDateString('en-US', options);

    // Initialize Connection and Fetch Metadata
    async function initializeApp() {
        try {
            updateConnectionStatus("loading", "Synchronizing Metadata...");
            const response = await fetch("/api/metadata");
            
            if (!response.ok) {
                throw new Error("Metadata request failed.");
            }
            
            const data = await response.json();
            state.stores = data.stores;
            state.items = data.items;
            state.minDate = data.min_date;
            state.maxDate = data.max_date;
            
            // Set min values on date inputs (allow unlimited future dates)
            elements.inputSingleDate.min = state.minDate;
            elements.inputSingleDate.value = state.maxDate; // Default to max historical date
            
            elements.inputTrendDate.min = state.minDate;
            elements.inputTrendDate.value = state.maxDate;

            // Update stats panel
            elements.statStores.textContent = state.stores.length;
            elements.statItems.textContent = state.items.length.toLocaleString();
            elements.statDates.textContent = `${formatDateLabel(state.minDate)} - ${formatDateLabel(state.maxDate)}`;
            
            updateConnectionStatus("connected", "Connected to Backend Model");
            
            // Hide Loader
            elements.loaderOverlay.classList.add("hide");
            setupAutocompletes();
            
            console.log("Aura Forecast successfully initialized.");
        } catch (err) {
            console.error("Initialization error:", err);
            updateConnectionStatus("failed", "Backend Offline - Retrying...");
            setTimeout(initializeApp, 3000);
        }
    }

    function formatDateLabel(dateStr) {
        const d = new Date(dateStr + "T00:00:00");
        const months = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
        return `${months[d.getMonth()]} ${d.getFullYear()}`;
    }

    function updateConnectionStatus(status, text) {
        elements.connectionStatus.textContent = text;
        elements.statusIndicator.classList.remove("connected", "failed");
        if (status === "connected") {
            elements.statusIndicator.classList.add("connected");
        }
    }

    // Theme Toggle Handler
    elements.themeToggleBtn.addEventListener("click", () => {
        document.body.classList.toggle("light-theme");
        const isLightTheme = document.body.classList.contains("light-theme");
        
        // Update button text and icons
        if (isLightTheme) {
            elements.themeLbl.textContent = "Dark Theme";
            elements.sunIcon.classList.remove("hide");
            elements.moonIcon.classList.add("hide");
        } else {
            elements.themeLbl.textContent = "Light Theme";
            elements.sunIcon.classList.add("hide");
            elements.moonIcon.classList.remove("hide");
        }
        
        // Update chart design if chart exists
        if (state.chartInstance) {
            const gridColor = isLightTheme ? "rgba(0, 0, 0, 0.05)" : "rgba(255, 255, 255, 0.03)";
            const tickColor = isLightTheme ? "#475569" : "#94a3b8";
            const histLine = isLightTheme ? "#64748b" : "#94a3b8";
            const foreLine = isLightTheme ? "#0284c7" : "#00f2fe";
            
            state.chartInstance.data.datasets[0].borderColor = histLine;
            state.chartInstance.data.datasets[0].pointBackgroundColor = histLine;
            state.chartInstance.data.datasets[1].borderColor = foreLine;
            state.chartInstance.data.datasets[1].pointBackgroundColor = foreLine;
            
            state.chartInstance.options.scales.x.grid.color = gridColor;
            state.chartInstance.options.scales.x.ticks.color = tickColor;
            state.chartInstance.options.scales.y.grid.color = gridColor;
            state.chartInstance.options.scales.y.ticks.color = tickColor;
            
            state.chartInstance.update();
        }
    });

    // 2. TAB CONTROLLER
    elements.navItems.forEach(item => {
        item.addEventListener("click", () => {
            const tabId = item.getAttribute("data-tab");
            
            // Remove active classes
            elements.navItems.forEach(n => n.classList.remove("active"));
            elements.tabPanes.forEach(tp => tp.classList.remove("active"));
            
            // Set active class
            item.classList.add("active");
            document.getElementById(tabId).classList.add("active");
            
            // Update Title / Subtitle
            if (tabId === "tab-overview") {
                elements.headerTitle.textContent = "System Overview";
                elements.headerSubtitle.textContent = "Interactive machine learning dashboard for retail demand planning.";
            } else if (tabId === "tab-predict") {
                elements.headerTitle.textContent = "Single Point Forecaster";
                elements.headerSubtitle.textContent = "Run specific scenario evaluations for store-item pairs.";
            } else if (tabId === "tab-trend") {
                elements.headerTitle.textContent = "Trend Analyst";
                elements.headerSubtitle.textContent = "Forecast sequential demand over a 7-day projection timeline.";
                
                // Trigger chart resize helper on showing tab
                if (state.chartInstance) {
                    setTimeout(() => state.chartInstance.resize(), 10);
                }
            }
        });
    });

    // 3. ACCORDION CONTROLLER
    elements.btnAccordion.addEventListener("click", (e) => {
        e.preventDefault();
        elements.btnAccordion.classList.toggle("active");
        elements.accordionBody.classList.toggle("hide");
    });

    // 4. SUGGESTION COMBOS INTERACTION (DASHBOARD CLICK)
    document.getElementById("suggestion-container").addEventListener("click", (e) => {
        const comboPill = e.target.closest(".combo-pill");
        if (!comboPill) return;
        
        const storeNbr = parseInt(comboPill.getAttribute("data-store"));
        const itemNbr = parseInt(comboPill.getAttribute("data-item"));
        const dateVal = comboPill.getAttribute("data-date");
        
        // Find store and item metadata
        const storeObj = state.stores.find(s => s.store_nbr === storeNbr);
        const itemObj = state.items.find(i => i.item_nbr === itemNbr);
        
        if (storeObj && itemObj) {
            // Load into Single Predictor Form
            state.selectedSingleStore = storeObj;
            state.selectedSingleItem = itemObj;
            
            elements.inputSingleStore.value = `${storeObj.store_nbr} - ${storeObj.city}, ${storeObj.state} (Type ${storeObj.store_type})`;
            elements.inputSingleItem.value = `${itemObj.item_nbr} - ${itemObj.family} (${itemObj.class})`;
            elements.inputSingleDate.value = dateVal;
            elements.inputSinglePromo.checked = false;
            
            // Switch to Single Forecast Tab
            document.getElementById("btn-tab-predict").click();
            
            // Auto submit
            triggerSinglePredictSubmit();
        }
    });

    // 5. AUTOCOMPLETE COMPONENT SETUP
    function setupAutocompletes() {
        // Single Predict: Store Input
        setupSearchAutocomplete(
            elements.inputSingleStore,
            elements.singleStoreList,
            state.stores,
            (store) => `${store.store_nbr} - ${store.city}, ${store.state} (Type ${store.store_type})`,
            (store) => `${store.city}, ${store.state} (Cluster ${store.cluster})`,
            (store) => {
                state.selectedSingleStore = store;
                elements.inputSingleStore.value = `${store.store_nbr} - ${store.city}, ${store.state}`;
            }
        );

        // Single Predict: Item Input
        setupSearchAutocomplete(
            elements.inputSingleItem,
            elements.singleItemList,
            state.items,
            (item) => `${item.item_nbr} - ${item.family}`,
            (item) => `Class ${item.class} • ${item.perishable ? 'Perishable' : 'Non-perishable'}`,
            (item) => {
                state.selectedSingleItem = item;
                elements.inputSingleItem.value = `${item.item_nbr} - ${item.family}`;
            }
        );

        // Trend Predict: Store Input
        setupSearchAutocomplete(
            elements.inputTrendStore,
            elements.trendStoreList,
            state.stores,
            (store) => `${store.store_nbr} - ${store.city}, ${store.state} (Type ${store.store_type})`,
            (store) => `${store.city}, ${store.state} (Cluster ${store.cluster})`,
            (store) => {
                state.selectedTrendStore = store;
                elements.inputTrendStore.value = `${store.store_nbr} - ${store.city}, ${store.state}`;
            }
        );

        // Trend Predict: Item Input
        setupSearchAutocomplete(
            elements.inputTrendItem,
            elements.trendItemList,
            state.items,
            (item) => `${item.item_nbr} - ${item.family}`,
            (item) => `Class ${item.class} • ${item.perishable ? 'Perishable' : 'Non-perishable'}`,
            (item) => {
                state.selectedTrendItem = item;
                elements.inputTrendItem.value = `${item.item_nbr} - ${item.family}`;
            }
        );
    }

    function setupSearchAutocomplete(inputEl, listEl, dataSrc, getTitle, getSubtitle, onSelect) {
        inputEl.addEventListener("input", () => {
            const query = inputEl.value.trim().toLowerCase();
            listEl.innerHTML = "";
            
            if (!query) {
                listEl.classList.remove("show");
                return;
            }

            // Filter up to 15 matching items
            const matches = [];
            for (let i = 0; i < dataSrc.length; i++) {
                const item = dataSrc[i];
                let matchesQuery = false;
                
                // Dynamic fields checking
                if (item.store_nbr !== undefined) {
                    matchesQuery = item.store_nbr.toString().includes(query) || 
                                   item.city.toLowerCase().includes(query) ||
                                   item.state.toLowerCase().includes(query);
                } else if (item.item_nbr !== undefined) {
                    matchesQuery = item.item_nbr.toString().includes(query) || 
                                   item.family.toLowerCase().includes(query);
                }
                
                if (matchesQuery) {
                    matches.push(item);
                    if (matches.length >= 15) break; // Limit suggestions for high speed
                }
            }

            if (matches.length === 0) {
                listEl.classList.remove("show");
                return;
            }

            matches.forEach(item => {
                const div = document.createElement("div");
                div.className = "autocomplete-item";
                
                const titleSpan = document.createElement("span");
                titleSpan.className = "item-title";
                titleSpan.textContent = getTitle(item);
                
                const subSpan = document.createElement("span");
                subSpan.className = "item-desc";
                subSpan.textContent = getSubtitle(item);
                
                div.appendChild(titleSpan);
                div.appendChild(subSpan);
                
                div.addEventListener("click", () => {
                    onSelect(item);
                    listEl.innerHTML = "";
                    listEl.classList.remove("show");
                });
                
                listEl.appendChild(div);
            });
            
            listEl.classList.add("show");
        });

        // Hide list when clicking outside
        document.addEventListener("click", (e) => {
            if (e.target !== inputEl && e.target !== listEl) {
                listEl.classList.remove("show");
            }
        });
    }

    // 6. SINGLE PREDICTION SUBMIT
    elements.formSingle.addEventListener("submit", (e) => {
        e.preventDefault();
        triggerSinglePredictSubmit();
    });

    async function triggerSinglePredictSubmit() {
        if (!state.selectedSingleStore) {
            // Check if input value matches directly (user typed exact number)
            const typedVal = elements.inputSingleStore.value.split(" ")[0];
            const foundStore = state.stores.find(s => s.store_nbr.toString() === typedVal);
            if (foundStore) state.selectedSingleStore = foundStore;
            else {
                alert("Please select a valid Store from the search autocomplete suggestions.");
                return;
            }
        }
        
        if (!state.selectedSingleItem) {
            const typedVal = elements.inputSingleItem.value.split(" ")[0];
            const foundItem = state.items.find(i => i.item_nbr.toString() === typedVal);
            if (foundItem) state.selectedSingleItem = foundItem;
            else {
                alert("Please select a valid Item from the search autocomplete suggestions.");
                return;
            }
        }

        const payload = {
            store_nbr: state.selectedSingleStore.store_nbr,
            item_nbr: state.selectedSingleItem.item_nbr,
            date: elements.inputSingleDate.value,
            onpromotion: elements.inputSinglePromo.checked
        };

        // UI Loading state
        elements.btnSingleSubmit.classList.add("loading");
        elements.btnSingleSubmit.disabled = true;
        elements.resultPanel.classList.remove("empty");
        elements.resultPlaceholder.classList.add("hide");
        elements.resultDisplay.classList.add("hide");

        try {
            const response = await fetch("/api/predict", {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify(payload)
            });

            if (!response.ok) {
                const errorData = await response.json();
                throw new Error(errorData.detail || "Prediction engine error.");
            }

            const data = await response.json();
            populateSingleResults(data);
        } catch (err) {
            console.error("Prediction failed:", err);
            alert("Prediction Error: " + err.message);
            elements.resultPanel.classList.add("empty");
            elements.resultPlaceholder.classList.remove("hide");
        } finally {
            elements.btnSingleSubmit.classList.remove("loading");
            elements.btnSingleSubmit.disabled = false;
        }
    }

    function populateSingleResults(data) {
        elements.resultDisplay.classList.remove("hide");
        
        // Animate predicted sales count (Odometer effect)
        animateValue(elements.predictedSalesVal, 0, data.predicted_unit_sales, 800);
        
        // Populate profile metadata
        const store = state.selectedSingleStore;
        elements.resStoreLoc.textContent = `${store.city}, ${store.state}`;
        elements.resStoreType.textContent = `${store.store_type} (Cluster ${store.cluster})`;
        
        const item = state.selectedSingleItem;
        elements.resItemFam.textContent = item.family;
        elements.resItemClass.textContent = item.class;
        
        // Parse date for day of week
        const dObj = new Date(data.date + "T00:00:00");
        const weekday = dObj.toLocaleDateString("en-US", { weekday: "long" });
        elements.resDateDay.textContent = weekday;
        
        // Holiday/Promo metrics
        elements.resDateHoliday.textContent = data.features.holiday_type !== "No Holiday" 
            ? `${data.features.holiday_type} (${data.features.locale_name})`
            : "No Holiday";
        
        elements.resOilPrice.textContent = data.features.dcoilwtico 
            ? `$${data.features.dcoilwtico.toFixed(2)}`
            : "$0.00";
            
        elements.resPromo.textContent = data.features.onpromotion ? "Yes (Active)" : "No (Disabled)";

        // Populate accordion features
        elements.featLag1.textContent = formatFeatureNum(data.features.lag_1);
        elements.featLag7.textContent = formatFeatureNum(data.features.lag_7);
        elements.featRollMean.textContent = formatFeatureNum(data.features.rolling_mean_7);
        elements.featRollMean30.textContent = formatFeatureNum(data.features.rolling_mean_30);
        elements.featOilDiff.textContent = data.features.oil_two_days_diff 
            ? data.features.oil_two_days_diff.toFixed(4)
            : "0.0000";
        elements.featWeekend.textContent = data.features.is_weekend;
    }

    function formatFeatureNum(val) {
        if (val === null || val === undefined) return "N/A";
        return val.toFixed(2);
    }

    function animateValue(obj, start, end, duration) {
        let startTimestamp = null;
        const step = (timestamp) => {
            if (!startTimestamp) startTimestamp = timestamp;
            const progress = Math.min((timestamp - startTimestamp) / duration, 1);
            const currentVal = progress * (end - start) + start;
            obj.textContent = currentVal.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
            if (progress < 1) {
                window.requestAnimationFrame(step);
            }
        };
        window.requestAnimationFrame(step);
    }

    // 7. TREND FORECASTER SUBMIT
    elements.formTrend.addEventListener("submit", (e) => {
        e.preventDefault();
        triggerTrendForecastSubmit();
    });

    async function triggerTrendForecastSubmit() {
        if (!state.selectedTrendStore) {
            const typedVal = elements.inputTrendStore.value.split(" ")[0];
            const foundStore = state.stores.find(s => s.store_nbr.toString() === typedVal);
            if (foundStore) state.selectedTrendStore = foundStore;
            else {
                alert("Please select a valid Store.");
                return;
            }
        }
        
        if (!state.selectedTrendItem) {
            const typedVal = elements.inputTrendItem.value.split(" ")[0];
            const foundItem = state.items.find(i => i.item_nbr.toString() === typedVal);
            if (foundItem) state.selectedTrendItem = foundItem;
            else {
                alert("Please select a valid Item.");
                return;
            }
        }

        const payload = {
            store_nbr: state.selectedTrendStore.store_nbr,
            item_nbr: state.selectedTrendItem.item_nbr,
            start_date: elements.inputTrendDate.value,
            days: 7,
            onpromotion: elements.inputTrendPromo.checked
        };

        // Loading states
        elements.btnTrendSubmit.classList.add("loading");
        elements.btnTrendSubmit.disabled = true;
        elements.timelineResultsWrap.classList.add("hide");

        try {
            const response = await fetch("/api/forecast", {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify(payload)
            });

            if (!response.ok) {
                const errorData = await response.json();
                throw new Error(errorData.detail || "Forecasting service failure.");
            }

            const data = await response.json();
            renderTrendResults(data);
        } catch (err) {
            console.error("Forecasting timeline generation failed:", err);
            alert("Forecasting Error: " + err.message);
        } finally {
            elements.btnTrendSubmit.classList.remove("loading");
            elements.btnTrendSubmit.disabled = false;
        }
    }

    function renderTrendResults(data) {
        // Update labels
        elements.chartTitle.textContent = `Forecast: Store ${data.store_nbr} • Item ${data.item_nbr}`;
        
        const store = state.selectedTrendStore;
        const item = state.selectedTrendItem;
        elements.chartSubtitle.textContent = `Visualizing timeline trend for ${item.family} class ${item.class} at ${store.city}, ${store.state}.`;
        
        // Show detail sections
        elements.timelineResultsWrap.classList.remove("hide");

        // 1. Populate Day Cards
        elements.timelineGrid.innerHTML = "";
        data.forecast.forEach(item => {
            const cardDate = new Date(item.date + "T00:00:00");
            const dayName = cardDate.toLocaleDateString("en-US", { weekday: "short" });
            const dateStr = cardDate.toLocaleDateString("en-US", { month: "short", day: "numeric" });
            
            const card = document.createElement("div");
            card.className = "day-card";
            if (item.onpromotion) {
                card.classList.add("promo-active");
            }
            
            const daySpan = document.createElement("div");
            daySpan.className = "day-lbl";
            daySpan.textContent = dayName;
            
            const dateSpan = document.createElement("div");
            dateSpan.className = "date-lbl";
            dateSpan.textContent = dateStr;
            
            const valSpan = document.createElement("div");
            valSpan.className = "value-lbl";
            valSpan.textContent = item.predicted_unit_sales.toFixed(1);
            
            card.appendChild(daySpan);
            card.appendChild(dateSpan);
            card.appendChild(valSpan);
            
            elements.timelineGrid.appendChild(card);
        });

        // 2. Build Chart
        renderChart(data.history, data.forecast);
    }

    function renderChart(historyPoints, forecastPoints) {
        const ctx = document.getElementById("forecastChart").getContext("2d");
        
        // Format dates and data streams
        const allLabels = [];
        const histData = [];
        const foreData = [];
        
        // Fill history
        historyPoints.forEach(p => {
            allLabels.push(formatChartDate(p.date));
            histData.push(p.unit_sales);
            foreData.push(null); // No forecast on history dates
        });
        
        // Transition Point: connect history last point to forecast first point
        const hasHistory = historyPoints.length > 0;
        if (hasHistory) {
            const lastHist = historyPoints[historyPoints.length - 1];
            // Push forecast start
            allLabels.push(formatChartDate(forecastPoints[0].date));
            histData.push(lastHist.unit_sales); // Connect history line
            foreData.push(lastHist.unit_sales); // Connect forecast line
        }
        
        // Fill forecast
        forecastPoints.forEach((p, idx) => {
            if (idx === 0 && hasHistory) {
                // Already pushed transition point
                return;
            }
            allLabels.push(formatChartDate(p.date));
            histData.push(null);
            foreData.push(p.predicted_unit_sales);
        });

        if (state.chartInstance) {
            state.chartInstance.destroy();
        }

        const isLightTheme = document.body.classList.contains("light-theme");
        const gridColor = isLightTheme ? "rgba(0, 0, 0, 0.05)" : "rgba(255, 255, 255, 0.03)";
        const tickColor = isLightTheme ? "#475569" : "#94a3b8";
        const histLine = isLightTheme ? "#64748b" : "#94a3b8";
        const foreLine = isLightTheme ? "#0284c7" : "#00f2fe";
        const tooltipBg = isLightTheme ? "rgba(255, 255, 255, 0.98)" : "rgba(15, 17, 36, 0.95)";
        const tooltipBorder = isLightTheme ? "rgba(0, 0, 0, 0.08)" : "rgba(255, 255, 255, 0.08)";
        const tooltipTitleColor = isLightTheme ? "#0f172a" : "#ffffff";
        const tooltipBodyColor = isLightTheme ? "#475569" : "#94a3b8";

        // Setup chart themes and fonts
        state.chartInstance = new Chart(ctx, {
            type: 'line',
            data: {
                labels: allLabels,
                datasets: [
                    {
                        label: 'Historical Sales',
                        data: histData,
                        borderColor: histLine,
                        borderWidth: 2,
                        pointBackgroundColor: histLine,
                        pointBorderColor: isLightTheme ? '#ffffff' : '#0f172a',
                        pointRadius: 4,
                        pointHoverRadius: 6,
                        spanGaps: false,
                        fill: false
                    },
                    {
                        label: 'Forecasted Demand',
                        data: foreData,
                        borderColor: foreLine,
                        borderWidth: 3,
                        pointBackgroundColor: foreLine,
                        pointBorderColor: isLightTheme ? '#ffffff' : '#0f172a',
                        pointRadius: 5,
                        pointHoverRadius: 7,
                        spanGaps: false,
                        fill: false
                    }
                ]
            },
            options: {
                responsive: true,
                maintainAspectRatio: false,
                plugins: {
                    legend: {
                        display: false // Using custom legends in HTML
                    },
                    tooltip: {
                        backgroundColor: tooltipBg,
                        borderColor: tooltipBorder,
                        borderWidth: 1,
                        titleColor: tooltipTitleColor,
                        bodyColor: tooltipBodyColor,
                        titleFont: {
                            family: 'Outfit',
                            size: 13,
                            weight: '600'
                        },
                        bodyFont: {
                            family: 'Inter',
                            size: 12
                        },
                        callbacks: {
                            label: function(context) {
                                let label = context.dataset.label || '';
                                if (label) {
                                    label += ': ';
                                }
                                if (context.parsed.y !== null) {
                                    label += context.parsed.y.toLocaleString("en-US", { minimumFractionDigits: 1, maximumFractionDigits: 1 }) + ' units';
                                }
                                return label;
                            }
                        }
                    }
                },
                scales: {
                    x: {
                        grid: {
                            color: gridColor
                        },
                        ticks: {
                            color: tickColor,
                            font: {
                                family: 'Inter',
                                size: 10
                            }
                        }
                    },
                    y: {
                        grid: {
                            color: gridColor
                        },
                        ticks: {
                            color: tickColor,
                            font: {
                                family: 'JetBrains Mono',
                                size: 10
                            }
                        }
                    }
                }
            }
        });
    }

    function formatChartDate(dateStr) {
        const d = new Date(dateStr + "T00:00:00");
        return d.toLocaleDateString("en-US", { month: "short", day: "numeric" });
    }

    // Trigger Initial Setup
    initializeApp();
});
