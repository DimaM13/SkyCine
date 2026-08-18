import axios from 'axios';
import { db } from '../config/db';

const TMDB_BASE_URL = 'https://api.themoviedb.org/3';
const TMDB_IMAGE_BASE = 'https://image.tmdb.org/t/p';

export interface TMDBMetadata {
  title: string;
  originalTitle?: string;
  overview?: string;
  posterPath?: string;
  backdropPath?: string;
  rating?: number;
  genres?: string[];
  year?: number;
}

class TMDBService {
  private getApiKey(): string {
    const row = db.prepare('SELECT value FROM server_settings WHERE key = ?').get('tmdbApiKey') as { value: string } | undefined;
    return row?.value || process.env.TMDB_API_KEY || '';
  }

  public async searchMovie(title: string, year?: number): Promise<TMDBMetadata | null> {
    const apiKey = this.getApiKey();
    if (!apiKey) {
      // Fallback if no API key is provided
      return {
        title,
        overview: 'Локальный фильм из библиотеки. Настройте TMDB API ключ в админ-панели для автоматической загрузки постеров и описаний.',
        year,
      };
    }

    try {
      const response = await axios.get(`${TMDB_BASE_URL}/search/movie`, {
        params: {
          api_key: apiKey,
          query: title,
          year: year || undefined,
          language: 'ru-RU',
          include_adult: false,
        },
        timeout: 6000,
      });

      const results = response.data?.results;
      if (!results || results.length === 0) {
        // Retry with English if Russian has no match
        const enResponse = await axios.get(`${TMDB_BASE_URL}/search/movie`, {
          params: {
            api_key: apiKey,
            query: title,
            year: year || undefined,
            language: 'en-US',
          },
          timeout: 6000,
        });
        const enResults = enResponse.data?.results;
        if (!enResults || enResults.length === 0) return null;
        return this.formatMovieResult(enResults[0]);
      }

      return this.formatMovieResult(results[0]);
    } catch (error) {
      console.error('TMDB Search Error:', (error as Error).message);
      return null;
    }
  }

  public async searchShow(title: string, year?: number): Promise<TMDBMetadata | null> {
    const apiKey = this.getApiKey();
    if (!apiKey) {
      return {
        title,
        overview: 'Локальный сериал из библиотеки.',
        year,
      };
    }

    try {
      const response = await axios.get(`${TMDB_BASE_URL}/search/tv`, {
        params: {
          api_key: apiKey,
          query: title,
          first_air_date_year: year || undefined,
          language: 'ru-RU',
        },
        timeout: 6000,
      });

      const results = response.data?.results;
      if (!results || results.length === 0) return null;

      const item = results[0];
      return {
        title: item.name || title,
        originalTitle: item.original_name,
        overview: item.overview,
        posterPath: item.poster_path ? `${TMDB_IMAGE_BASE}/w500${item.poster_path}` : undefined,
        backdropPath: item.backdrop_path ? `${TMDB_IMAGE_BASE}/original${item.backdrop_path}` : undefined,
        rating: item.vote_average,
        year: item.first_air_date ? parseInt(item.first_air_date.substring(0, 4), 10) : year,
      };
    } catch (error) {
      console.error('TMDB TV Search Error:', (error as Error).message);
      return null;
    }
  }

  public async searchCandidates(query: string, type: 'MOVIE' | 'SHOW' = 'MOVIE', year?: number): Promise<TMDBMetadata[]> {
    const apiKey = this.getApiKey();
    if (!apiKey) {
      return [];
    }

    try {
      const endpoint = type === 'SHOW' ? `${TMDB_BASE_URL}/search/tv` : `${TMDB_BASE_URL}/search/movie`;
      const params: any = {
        api_key: apiKey,
        query,
        language: 'ru-RU',
        include_adult: false,
      };
      if (year) {
        if (type === 'SHOW') params.first_air_date_year = year;
        else params.year = year;
      }

      const response = await axios.get(endpoint, { params, timeout: 6000 });
      const results = response.data?.results || [];

      // Fallback search with en-US if ru returns empty
      if (results.length === 0) {
        params.language = 'en-US';
        const enResponse = await axios.get(endpoint, { params, timeout: 6000 });
        return (enResponse.data?.results || []).map((item: any) =>
          type === 'SHOW' ? this.formatShowResult(item) : this.formatMovieResult(item)
        );
      }

      return results.map((item: any) =>
        type === 'SHOW' ? this.formatShowResult(item) : this.formatMovieResult(item)
      );
    } catch (err) {
      console.error('searchCandidates error:', (err as Error).message);
      return [];
    }
  }

  private formatMovieResult(item: any): TMDBMetadata {
    return {
      title: item.title,
      originalTitle: item.original_title,
      overview: item.overview,
      posterPath: item.poster_path ? `${TMDB_IMAGE_BASE}/w500${item.poster_path}` : undefined,
      backdropPath: item.backdrop_path ? `${TMDB_IMAGE_BASE}/original${item.backdrop_path}` : undefined,
      rating: item.vote_average,
      year: item.release_date ? parseInt(item.release_date.substring(0, 4), 10) : undefined,
    };
  }

  private formatShowResult(item: any): TMDBMetadata {
    return {
      title: item.name,
      originalTitle: item.original_name,
      overview: item.overview,
      posterPath: item.poster_path ? `${TMDB_IMAGE_BASE}/w500${item.poster_path}` : undefined,
      backdropPath: item.backdrop_path ? `${TMDB_IMAGE_BASE}/original${item.backdrop_path}` : undefined,
      rating: item.vote_average,
      year: item.first_air_date ? parseInt(item.first_air_date.substring(0, 4), 10) : undefined,
    };
  }
}

export const tmdbService = new TMDBService();
