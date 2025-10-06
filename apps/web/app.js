/**
 * FinishLine AI - Frontend Application
 * Handles form submission, API calls, and result display
 */

// API Configuration
const LOCAL_API = "http://localhost:8000";
const SAME_ORIGIN = "";
const isLocal = location.hostname === "localhost" || location.hostname === "127.0.0.1";
const API_BASE = isLocal ? LOCAL_API : SAME_ORIGIN;

// DOM Elements
const raceForm = document.getElementById('raceForm');
const horsesContainer = document.getElementById('horsesContainer');
const addHorseBtn = document.getElementById('addHorseBtn');
const predictBtn = document.getElementById('predictBtn');
const photoPredictBtn = document.getElementById('photoPredictBtn');
const photoSection = document.getElementById('photoSection');
const photoInput = document.getElementById('photoInput');
const selectPhotosBtn = document.getElementById('selectPhotosBtn');
const photoPreview = document.getElementById('photoPreview');
const loadingSection = document.getElementById('loadingSection');
const resultsSection = document.getElementById('resultsSection');
const errorSection = document.getElementById('errorSection');
const errorText = document.getElementById('errorText');

// Initialize application
document.addEventListener('DOMContentLoaded', function() {
    console.log('FinishLine AI initialized');
    
    // Set dynamic year in footer
    const yearEl = document.getElementById("year"); 
    if (yearEl) yearEl.textContent = new Date().getFullYear();
    
    // Set today's date as default
    const today = new Date().toISOString().split('T')[0];
    document.getElementById('raceDate').value = today;
    
    // Event listeners
    addHorseBtn.addEventListener('click', addHorseEntry);
    predictBtn.addEventListener('click', handlePredict);
    photoPredictBtn.addEventListener('click', handlePhotoPredict);
    selectPhotosBtn.addEventListener('click', () => photoInput.click());
    photoInput.addEventListener('change', handlePhotoSelection);
    
    // Initial horse entry
    addHorseEntry();
});

/**
 * Add a new horse entry to the form
 */
function addHorseEntry() {
    const horseEntry = document.createElement('div');
    horseEntry.className = 'horse-entry';
    horseEntry.innerHTML = `
        <div class="form-row">
            <div class="form-group">
                <label>Horse Name</label>
                <input type="text" name="horseName" placeholder="e.g., Thunderstride" required>
            </div>
            <div class="form-group">
                <label>Odds</label>
                <input type="text" name="odds" placeholder="e.g., 5-2" required>
            </div>
            <div class="form-group">
                <label>Bankroll</label>
                <input type="number" name="bankroll" placeholder="1000" value="1000" min="1" required>
            </div>
            <div class="form-group">
                <label>Kelly Fraction</label>
                <input type="number" name="kellyFraction" placeholder="0.25" value="0.25" min="0" max="1" step="0.01" required>
            </div>
        </div>
        <button type="button" class="btn-secondary remove-horse" style="margin-top: 0.5rem;">Remove Horse</button>
    `;
    
    horsesContainer.appendChild(horseEntry);
    
    // Add remove functionality
    const removeBtn = horseEntry.querySelector('.remove-horse');
    removeBtn.addEventListener('click', () => {
        if (horsesContainer.children.length > 1) {
            horseEntry.remove();
        }
    });
}

/**
 * Handle photo selection
 */
function handlePhotoSelection(event) {
    const files = Array.from(event.target.files);
    
    if (files.length > 6) {
        showError('Maximum 6 photos allowed');
        return;
    }
    
    // Clear previous preview
    photoPreview.innerHTML = '';
    
    // Show preview for each file
    files.forEach(file => {
        if (file.type.startsWith('image/')) {
            const reader = new FileReader();
            reader.onload = function(e) {
                const img = document.createElement('img');
                img.src = e.target.result;
                img.alt = file.name;
                photoPreview.appendChild(img);
            };
            reader.readAsDataURL(file);
        }
    });
    
    // Show photo section
    photoSection.style.display = 'block';
}

/**
 * Handle regular prediction
 */
async function handlePredict() {
    try {
        const horses = collectHorseData();
        
        if (horses.length === 0) {
            showError('Please add at least one horse');
            return;
        }
        
        showLoading();
        hideError();
        hideResults();
        
        const response = await fetch(`${API_BASE}/api/finishline/predict`, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
            },
            body: JSON.stringify({ horses })
        });
        
        if (!response.ok) {
            throw new Error(`HTTP ${response.status}: ${response.statusText}`);
        }
        
        const data = await response.json();
        displayResults(data);
        
    } catch (error) {
        console.error('Prediction error:', error);
        showError(`Prediction failed: ${error.message}`);
    } finally {
        hideLoading();
    }
}

/**
 * Handle photo prediction
 */
async function handlePhotoPredict() {
    try {
        const files = Array.from(photoInput.files);
        
        if (files.length === 0) {
            showError('Please select at least one photo');
            return;
        }
        
        showLoading();
        hideError();
        hideResults();
        
        const formData = new FormData();
        files.forEach(file => {
            formData.append('files', file);
        });
        
        const response = await fetch(`${API_BASE}/api/finishline/photo_predict`, {
            method: 'POST',
            body: formData
        });
        
        if (!response.ok) {
            throw new Error(`HTTP ${response.status}: ${response.statusText}`);
        }
        
        const data = await response.json();
        displayResults(data);
        
    } catch (error) {
        console.error('Photo prediction error:', error);
        showError(`Photo analysis failed: ${error.message}`);
    } finally {
        hideLoading();
    }
}

/**
 * Collect horse data from form
 */
function collectHorseData() {
    const horses = [];
    const horseEntries = horsesContainer.querySelectorAll('.horse-entry');
    
    horseEntries.forEach(entry => {
        const name = entry.querySelector('input[name="horseName"]').value.trim();
        const odds = entry.querySelector('input[name="odds"]').value.trim();
        const bankroll = parseFloat(entry.querySelector('input[name="bankroll"]').value);
        const kellyFraction = parseFloat(entry.querySelector('input[name="kellyFraction"]').value);
        
        if (name && odds && !isNaN(bankroll) && !isNaN(kellyFraction)) {
            horses.push({
                name,
                odds,
                bankroll,
                kelly_fraction: kellyFraction
            });
        }
    });
    
    return horses;
}

/**
 * Display prediction results
 */
function displayResults(data) {
    const { win, place, show } = data;
    
    // Update WIN card
    document.getElementById('winName').textContent = win.name;
    document.getElementById('winOdds').textContent = `Odds: ${win.odds}`;
    document.getElementById('winProb').textContent = `Probability: ${(win.prob * 100).toFixed(1)}%`;
    document.getElementById('winKelly').textContent = `Kelly: ${(win.kelly * 100).toFixed(1)}%`;
    document.getElementById('winRationale').textContent = win.rationale || 'AI analysis complete';
    
    // Update PLACE card
    document.getElementById('placeName').textContent = place.name;
    document.getElementById('placeOdds').textContent = `Odds: ${place.odds}`;
    document.getElementById('placeProb').textContent = `Probability: ${(place.prob * 100).toFixed(1)}%`;
    document.getElementById('placeKelly').textContent = `Kelly: ${(place.kelly * 100).toFixed(1)}%`;
    document.getElementById('placeRationale').textContent = place.rationale || 'AI analysis complete';
    
    // Update SHOW card
    document.getElementById('showName').textContent = show.name;
    document.getElementById('showOdds').textContent = `Odds: ${show.odds}`;
    document.getElementById('showProb').textContent = `Probability: ${(show.prob * 100).toFixed(1)}%`;
    document.getElementById('showKelly').textContent = `Kelly: ${(show.kelly * 100).toFixed(1)}%`;
    document.getElementById('showRationale').textContent = show.rationale || 'AI analysis complete';
    
    // Show results with animation
    resultsSection.style.display = 'block';
    resultsSection.scrollIntoView({ behavior: 'smooth' });
}

/**
 * Show loading state
 */
function showLoading() {
    loadingSection.style.display = 'block';
    loadingSection.scrollIntoView({ behavior: 'smooth' });
}

/**
 * Hide loading state
 */
function hideLoading() {
    loadingSection.style.display = 'none';
}

/**
 * Show error message
 */
function showError(message) {
    errorText.textContent = message;
    errorSection.style.display = 'block';
    errorSection.scrollIntoView({ behavior: 'smooth' });
}

/**
 * Hide error message
 */
function hideError() {
    errorSection.style.display = 'none';
}

/**
 * Hide results section
 */
function hideResults() {
    resultsSection.style.display = 'none';
}

/**
 * Test API connectivity
 */
async function testAPI() {
    try {
        const response = await fetch(`${API_BASE}/api/finishline/health`);
        const data = await response.json();
        console.log('API Health Check:', data);
        return data.status === 'ok';
    } catch (error) {
        console.error('API Health Check Failed:', error);
        return false;
    }
}

// Test API on load
testAPI();
