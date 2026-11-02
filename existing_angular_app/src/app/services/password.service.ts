import { Injectable, signal } from '@angular/core';
import { PASSWORD_CONFIG } from '../../password.config';

const COOKIE_NAME = 'app_auth';

@Injectable({ providedIn: 'root' })
export class PasswordService {
  private readonly configuredHash: Promise<string>;
  readonly authenticated = signal(false);

  constructor() {
    this.configuredHash = this.sha256(PASSWORD_CONFIG.password);
  }

  /** Returns true if the stored cookie matches the current configured password hash. */
  async isAuthenticated(): Promise<boolean> {
    const cookieHash = this.getCookie(COOKIE_NAME);
    if (!cookieHash) return false;
    const currentHash = await this.configuredHash;
    const result = cookieHash === currentHash;
    this.authenticated.set(result);
    return result;
  }

  /** Validates the entered password and, if correct, stores the hash as a cookie. */
  async login(enteredPassword: string): Promise<boolean> {
    const enteredHash = await this.sha256(enteredPassword);
    const currentHash = await this.configuredHash;
    if (enteredHash === currentHash) {
      // Store hash in cookie – valid for 365 days
      const expires = new Date();
      expires.setFullYear(expires.getFullYear() + 1);
      document.cookie = `${COOKIE_NAME}=${enteredHash}; expires=${expires.toUTCString()}; path=/; SameSite=Strict`;
      this.authenticated.set(true);
      return true;
    }
    return false;
  }

  private getCookie(name: string): string | null {
    const match = document.cookie.match(new RegExp('(?:^|; )' + name + '=([^;]*)'));
    return match ? decodeURIComponent(match[1]) : null;
  }

  private async sha256(message: string): Promise<string> {
    const msgBuffer = new TextEncoder().encode(message);
    const hashBuffer = await crypto.subtle.digest('SHA-256', msgBuffer);
    const hashArray = Array.from(new Uint8Array(hashBuffer));
    return hashArray.map((b) => b.toString(16).padStart(2, '0')).join('');
  }
}
