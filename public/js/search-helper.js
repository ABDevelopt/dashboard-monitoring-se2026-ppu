/**
 * Search Helper Library
 * Implementing Fuzzy Matching (Levenshtein) and BM25 Relevance Ranking
 */

// 1. Levenshtein Distance (Edit Distance)
function levenshtein(s1, s2) {
  s1 = s1.toLowerCase();
  s2 = s2.toLowerCase();
  const m = s1.length;
  const n = s2.length;
  
  const dp = Array.from({ length: m + 1 }, () => new Array(n + 1).fill(0));
  
  for (let i = 0; i <= m; i++) dp[i][0] = i;
  for (let j = 0; j <= n; j++) dp[0][j] = j;
  
  for (let i = 1; i <= m; i++) {
    for (let j = 1; j <= n; j++) {
      if (s1[i - 1] === s2[j - 1]) {
        dp[i][j] = dp[i - 1][j - 1];
      } else {
        dp[i][j] = Math.min(
          dp[i - 1][j] + 1,    // deletion
          dp[i][j - 1] + 1,    // insertion
          dp[i - 1][j - 1] + 1 // substitution
        );
      }
    }
  }
  return dp[m][n];
}

// 2. Token Similarity metric between 0 and 1
function getTokenSimilarity(qToken, dToken) {
  if (qToken === dToken) return 1.0;
  
  // Prefix match
  if (dToken.startsWith(qToken)) {
    return 0.9 + 0.1 * (qToken.length / dToken.length);
  }
  
  // Substring match
  if (dToken.includes(qToken)) {
    return 0.8;
  }

  // Levenshtein-based fuzzy match for longer words
  const maxLen = Math.max(qToken.length, dToken.length);
  if (maxLen < 3) return 0.0;
  
  const allowedDist = qToken.length <= 5 ? 1 : 2;
  const dist = levenshtein(qToken, dToken);
  
  if (dist <= allowedDist) {
    return (maxLen - dist) / maxLen;
  }
  
  return 0.0;
}

// 3. Simple fuzzy string match helper for inline items (e.g. menu search, selects)
function fuzzyMatch(text, query, threshold = 0.5) {
  if (!query) return true;
  if (!text) return false;
  
  const qClean = query.toLowerCase().trim();
  const tClean = text.toLowerCase().trim();
  
  if (tClean.includes(qClean)) return true;
  
  const qWords = qClean.split(/\s+/).filter(w => w.length > 0);
  const tWords = tClean.split(/\s+/).filter(w => w.length > 0);
  
  if (qWords.length === 0) return true;
  
  // Every query word must match at least one document word fuzzily
  return qWords.every(qw => {
    return tWords.some(tw => getTokenSimilarity(qw, tw) >= threshold);
  });
}

// 4. BM25 Class for ranking documents
class FuzzyBM25 {
  constructor(documents, config = {}) {
    // documents: array of { id, text, ref }
    this.documents = documents;
    this.k1 = config.k1 !== undefined ? config.k1 : 1.2;
    this.b = config.b !== undefined ? config.b : 0.75;
    
    this.avgDocLength = 0;
    this.docLengths = {};
    this.docTokens = {};
    this.df = {};  // Document frequency
    this.idf = {}; // Inverse document frequency
    
    this.initialize();
  }

  tokenize(text) {
    if (!text) return [];
    return text.toLowerCase()
      .replace(/[^a-z0-9\s]/g, ' ')
      .split(/\s+/)
      .filter(w => w.length > 0);
  }

  initialize() {
    let totalLength = 0;
    const N = this.documents.length;
    if (N === 0) return;

    this.documents.forEach(doc => {
      const tokens = this.tokenize(doc.text);
      this.docTokens[doc.id] = tokens;
      this.docLengths[doc.id] = tokens.length;
      totalLength += tokens.length;

      const uniqueTokens = new Set(tokens);
      uniqueTokens.forEach(token => {
        this.df[token] = (this.df[token] || 0) + 1;
      });
    });

    this.avgDocLength = totalLength / N;

    for (const term in this.df) {
      const n = this.df[term];
      // Standard BM25 IDF formula
      this.idf[term] = Math.log((N - n + 0.5) / (n + 0.5) + 1);
    }
  }

  search(query, threshold = 0.1) {
    const qTokens = this.tokenize(query);
    if (qTokens.length === 0) {
      // Return all documents with score 0
      return this.documents.map(doc => ({ doc, score: 0 }));
    }

    const scores = [];

    this.documents.forEach(doc => {
      const dTokens = this.docTokens[doc.id];
      const dl = this.docLengths[doc.id];
      let docScore = 0;

      qTokens.forEach(qToken => {
        let fuzzyTF = 0;
        
        dTokens.forEach(dToken => {
          const sim = getTokenSimilarity(qToken, dToken);
          if (sim > 0.5) {
            fuzzyTF += sim; // TF weight is scaled by similarity
          }
        });

        if (fuzzyTF > 0) {
          let idfVal = this.idf[qToken];
          if (idfVal === undefined) {
            // Fuzzy IDF estimation for words not in the main vocabulary
            let bestSim = 0;
            let bestToken = null;
            for (const term in this.df) {
              const sim = getTokenSimilarity(qToken, term);
              if (sim > bestSim) {
                bestSim = sim;
                bestToken = term;
              }
            }
            if (bestToken && bestSim > 0.6) {
              idfVal = this.idf[bestToken] * bestSim;
            } else {
              idfVal = Math.log(this.documents.length + 1);
            }
          }

          const numerator = fuzzyTF * (this.k1 + 1);
          const denominator = fuzzyTF + this.k1 * (1 - this.b + this.b * (dl / this.avgDocLength));
          docScore += idfVal * (numerator / denominator);
        }
      });

      if (docScore > threshold) {
        scores.push({
          doc: doc,
          score: docScore
        });
      }
    });

    return scores.sort((a, b) => b.score - a.score);
  }
}

// Export for Node.js if running in backend, otherwise expose globally in browser
if (typeof module !== 'undefined' && typeof module.exports !== 'undefined') {
  module.exports = {
    levenshtein,
    getTokenSimilarity,
    fuzzyMatch,
    FuzzyBM25
  };
} else {
  window.levenshtein = levenshtein;
  window.getTokenSimilarity = getTokenSimilarity;
  window.fuzzyMatch = fuzzyMatch;
  window.FuzzyBM25 = FuzzyBM25;
}
