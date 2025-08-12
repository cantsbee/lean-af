import './style.css'

class SpotifyFestivalAnalyzer {
  constructor() {
      this.clientId = '5a52712ea3974706921eee1534e53f7a'; // ¡IMPORTANTE! Reemplaza con tu Client ID real de Spotify
      this.redirectUri = 'https://lean-af.vercel.app/';
      this.scopes = 'user-top-read user-read-private user-read-email'; // Añadidos scopes necesarios
      this.accessToken = null;
      this.topArtists = [];
      
      this.init();
  }
  generateRandomString(length) {
      let text = "";
      const possible = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789";
      for (let i = 0; i < length; i++) {
          text += possible.charAt(Math.floor(Math.random() * possible.length));
      }
      return text;
  }

  async sha256(plain) {
      const encoder = new TextEncoder();
      const data = encoder.encode(plain);
      return window.crypto.subtle.digest("SHA-256", data);
  }

  base64encode(input) {
      return btoa(String.fromCharCode(...new Uint8Array(input)))
          .replace(/\+/g, "-")
          .replace(/\//g, "_")
          .replace(/=/g, "");
  }

  async generateCodeChallenge(codeVerifier) {
      const hashed = await this.sha256(codeVerifier);
      return this.base64encode(hashed);
  }

  async init() {
      const urlParams = new URLSearchParams(window.location.search);
      const code = urlParams.get("code");
      const storedVerifier = localStorage.getItem("code_verifier");

      if (code && storedVerifier) {
          await this.exchangeCodeForToken(code, storedVerifier);
      } else {
          this.setupEventListeners();
      }
  }
  async loginToSpotify() {
      const codeVerifier = this.generateRandomString(128);
      localStorage.setItem("code_verifier", codeVerifier);

      const codeChallenge = await this.generateCodeChallenge(codeVerifier);

      const authUrl = `https://accounts.spotify.com/authorize?` +
          `client_id=${this.clientId}&` +
          `response_type=code&` +
          `redirect_uri=${encodeURIComponent(this.redirectUri)}&` +
          `scope=${encodeURIComponent(this.scopes)}&` +
          `code_challenge_method=S256&` +
          `code_challenge=${codeChallenge}`;
      
      window.location.href = authUrl;
  }

  async exchangeCodeForToken(code, codeVerifier) {
      this.showStatus("Intercambiando código por token...", "loading");
      
      const response = await fetch("https://accounts.spotify.com/api/token", {
          method: "POST",
          headers: {
              "Content-Type": "application/x-www-form-urlencoded",
          },
          body: new URLSearchParams({
              client_id: this.clientId,
              grant_type: "authorization_code",
              code: code,
              redirect_uri: this.redirectUri,
              code_verifier: codeVerifier,
          }),
      });

      const data = await response.json();

      if (data.access_token) {
          this.accessToken = data.access_token;
          localStorage.setItem("access_token", data.access_token);
          localStorage.setItem("refresh_token", data.refresh_token);
          localStorage.setItem("expires_in", Date.now() + data.expires_in * 1000);
          this.showMainSection();
          await this.fetchTopArtists();
      } else {
          this.showStatus("Error al obtener token: " + data.error_description, "error");
      }
      this.hideStatus();
  }

  async fetchTopArtists() {
      if (!this.accessToken || Date.now() >= localStorage.getItem("expires_in")) {
          await this.refreshToken();
      }

      if (!this.accessToken) {
          this.showStatus("No se pudo obtener el token de acceso.", "error");
          return;
      }

      this.showStatus("Obteniendo tus artistas favoritos de Spotify...", "loading");
      
      try {
          const response = await fetch("https://api.spotify.com/v1/me/top/artists?limit=8", {
              headers: {
                  "Authorization": `Bearer ${this.accessToken}`
              }
          });

          if (response.ok) {
              const data = await response.json();
              this.topArtists = data.items.map(artist => ({
                  name: artist.name,
                  popularity: artist.popularity,
                  genres: artist.genres
              }));
              this.displayTopArtists();
          } else if (response.status === 401) {
              this.showStatus("Token expirado o inválido. Intentando refrescar...", "loading");
              await this.refreshToken();
              if (this.accessToken) {
                  await this.fetchTopArtists(); // Reintentar después de refrescar
              } else {
                  this.showStatus("No se pudo refrescar el token. Por favor, inicia sesión de nuevo.", "error");
                  this.loginToSpotify();
              }
          } else {
              const errorData = await response.json();
              this.showStatus(`Error al obtener artistas: ${errorData.error.message}`, "error");
          }
      } catch (error) {
          this.showStatus(`Error de red: ${error.message}`, "error");
      }
      this.hideStatus();
  }

  async refreshToken() {
      const refreshToken = localStorage.getItem("refresh_token");
      if (!refreshToken) {
          return;
      }

      const response = await fetch("https://accounts.spotify.com/api/token", {
          method: "POST",
          headers: {
              "Content-Type": "application/x-www-form-urlencoded",
          },
          body: new URLSearchParams({
              client_id: this.clientId,
              grant_type: "refresh_token",
              refresh_token: refreshToken,
          }),
      });

      const data = await response.json();

      if (data.access_token) {
          this.accessToken = data.access_token;
          localStorage.setItem("access_token", data.access_token);
          localStorage.setItem("expires_in", Date.now() + data.expires_in * 1000);
          if (data.refresh_token) {
              localStorage.setItem("refresh_token", data.refresh_token);
          }
      } else {
          console.error("Error al refrescar token:", data);
          this.accessToken = null; // Invalidar token si falla el refresco
      }
  }

  async analyzeFestivalLineup() {
      console.log("Iniciando análisis de lineup...");
      
      // Verificar si tenemos token de acceso
      if (!this.accessToken) {
          this.showStatus("No tienes acceso a Spotify. Por favor, conéctate primero.", "error");
          return;
      }

      // Verificar si tenemos artistas favoritos
      if (!this.topArtists || this.topArtists.length === 0) {
          this.showStatus("No se han cargado tus artistas favoritos. Intentando cargarlos...", "loading");
          await this.fetchTopArtists();
          if (!this.topArtists || this.topArtists.length === 0) {
              this.showStatus("No se pudieron cargar tus artistas favoritos.", "error");
              return;
          }
      }

      const lineupText = document.getElementById("lineup-input").value.trim();
      
      if (!lineupText) {
          this.showStatus("Por favor, introduce el lineup del festival", "error");
          return;
      }

      const lineupArtists = lineupText.split("\n")
          .map(artist => artist.trim())
          .filter(artist => artist.length > 0);

      if (lineupArtists.length === 0) {
          this.showStatus("No se encontraron artistas en el lineup", "error");
          return;
      }

      console.log(`Analizando ${lineupArtists.length} artistas:`, lineupArtists);
      this.showStatus(`Analizando ${lineupArtists.length} artistas del lineup...`, "loading");

      try {
          const recommendations = await this.calculateRecommendations(lineupArtists);
          console.log("Recomendaciones calculadas:", recommendations);
          this.displayRecommendations(recommendations);
          this.hideStatus();
      } catch (error) {
          console.error("Error durante el análisis:", error);
          this.showStatus(`Error durante el análisis: ${error.message}`, "error");
      }
  }

  async calculateRecommendations(lineupArtists) {
      const myGenres = this.extractGenres(this.topArtists);
      const myArtistNames = this.topArtists.map(a => a.name.toLowerCase());
      
      const recommendations = [];

      for (const artistName of lineupArtists) {
          let score = 0;
          let reasons = [];
          let spotifyArtist = null;

          // Buscar artista en Spotify
          try {
              const searchResponse = await fetch(`https://api.spotify.com/v1/search?q=${encodeURIComponent(artistName)}&type=artist&limit=1`, {
                  headers: {
                      "Authorization": `Bearer ${this.accessToken}`
                  }
              });
              const searchData = await searchResponse.json();
              if (searchData.artists && searchData.artists.items.length > 0) {
                  spotifyArtist = searchData.artists.items[0];
              }
          } catch (error) {
              console.error("Error buscando artista en Spotify:", error);
          }

          if (myArtistNames.includes(artistName.toLowerCase())) {
              score += 95;
              reasons.push("¡Es uno de tus artistas favoritos!");
          } else if (spotifyArtist) {
              // Usar popularidad real de Spotify
              score += spotifyArtist.popularity * 0.7; // Ajustar peso de popularidad

              // Comparar géneros
              const artistGenres = spotifyArtist.genres;
              const commonGenres = artistGenres.filter(genre => myGenres.includes(genre));
              if (commonGenres.length > 0) {
                  score += commonGenres.length * 10; // Puntuación por géneros comunes
                  reasons.push(`Compatible por géneros: ${commonGenres.join(", ")}`);
              }

              if (reasons.length === 0) {
                  reasons.push("Nuevo descubrimiento basado en tu historial de escucha.");
              }
          } else {
              // Si no se encuentra en Spotify, usar lógica de simulación anterior
              const artistLower = artistName.toLowerCase();
              if (this.hasRockGenres(myGenres)) {
                  if (artistLower.includes("rock") || artistLower.includes("indie") || artistLower.includes("alternative")) {
                      score += 75;
                      reasons.push("Compatible con tu gusto por el indie/alternative rock");
                  }
              }
              if (this.hasPopGenres(myGenres)) {
                  if (artistLower.includes("pop")) {
                      score += 70;
                      reasons.push("Compatible con tus gustos pop");
                  }
              }
              if (this.hasElectronicGenres(myGenres)) {
                  if (artistLower.includes("electronic") || artistLower.includes("psychedelic") || artistLower.includes("dance")) {
                      score += 65;
                      reasons.push("Compatible con tus gustos electrónicos/psicodélicos");
                  }
              }
              if (reasons.length === 0) {
                  reasons.push("Artista no encontrado en Spotify, recomendación basada en patrones de escucha.");
              }
              score += Math.random() * 30 + 20; // Popularidad base simulada
          }

          recommendations.push({
              name: artistName,
              score: Math.min(Math.round(score), 100),
              reasons: reasons
          });
      }

      return recommendations.sort((a, b) => b.score - a.score);
  }

  extractGenres(artists) {
      const allGenres = [];
      artists.forEach(artist => {
          if (artist.genres) {
              allGenres.push(...artist.genres);
          }
      });
      return [...new Set(allGenres)];
  }

  hasRockGenres(genres) {
      return genres.some(genre => 
          genre.includes("rock") || genre.includes("indie") || genre.includes("alternative")
      );
  }

  hasPopGenres(genres) {
      return genres.some(genre => 
          genre.includes("pop")
      );
  }

  hasElectronicGenres(genres) {
      return genres.some(genre => 
          genre.includes("electronic") || genre.includes("psychedelic") || genre.includes("dance")
      );
  }

  displayRecommendations(recommendations) {
      const container = document.getElementById("recommendations-list");
      const section = document.getElementById("recommendations");
      
      container.innerHTML = "";
      
      const topRecommendations = recommendations.slice(0, 10);
      
      topRecommendations.forEach(rec => {
          const recDiv = document.createElement("div");
          recDiv.className = "recommendation-item";
          
          const scoreColor = rec.score >= 80 ? "#1DB954" : 
                           rec.score >= 60 ? "#1DB954" : "#535353";
          
          recDiv.innerHTML = `
              <div class="match-score" style="background-color: ${scoreColor}">
                  ${rec.score}%
              </div>
              <div class="recommendation-content">
                  <div class="recommendation-name">${rec.name}</div>
                  <div class="recommendation-reason">${rec.reasons.join(", ")}</div>
              </div>
          `;
          
          container.appendChild(recDiv);
      });

      section.classList.remove("hidden");
  }

  setupEventListeners() {
      const loginBtn = document.getElementById("login-btn");
      const analyzeBtn = document.getElementById("analyze-btn");

      if (loginBtn) {
          loginBtn.addEventListener("click", () => {
              this.loginToSpotify();
          });
      }

      if (analyzeBtn) {
          analyzeBtn.addEventListener("click", () => {
              this.analyzeFestivalLineup();
          });
      }
  }

  showStatus(message, type = "info") {
      const statusElement = document.getElementById("status");
      if (statusElement) {
          statusElement.textContent = message;
          statusElement.className = `status ${type}`;
          statusElement.classList.remove("hidden");
          console.log(`Status [${type}]: ${message}`);
      }
  }

  hideStatus() {
      const statusElement = document.getElementById("status");
      if (statusElement) {
          statusElement.classList.add("hidden");
      }
  }

  showMainSection() {
      const loginSection = document.getElementById("login-section");
      const mainSection = document.getElementById("main-section");
      
      if (loginSection) loginSection.classList.add("hidden");
      if (mainSection) mainSection.classList.remove("hidden");
  }

  displayTopArtists() {
      const container = document.getElementById("top-artists");
      if (!container) return;

      container.innerHTML = "";
      
      this.topArtists.forEach((artist, index) => {
          const artistDiv = document.createElement("div");
          artistDiv.className = "artist-item";
          artistDiv.innerHTML = `
              <div class="artist-rank">${index + 1}</div>
              <div class="artist-info">
                  <div class="artist-name">${artist.name}</div>
                  <div class="artist-genres">${artist.genres.slice(0, 3).join(", ")}</div>
              </div>
              <div class="artist-popularity">
                  <div class="popularity-bar">
                      <div class="popularity-fill" style="width: ${artist.popularity}%"></div>
                  </div>
                  <span class="popularity-text">${artist.popularity}%</span>
              </div>
          `;
          container.appendChild(artistDiv);
      });
  }
}

// Inicializar la aplicación
document.addEventListener("DOMContentLoaded", () => {
  new SpotifyFestivalAnalyzer();
});
