import { Component, OnInit, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { PasswordService } from '../../services/password.service';

@Component({
  selector: 'app-password-dialog',
  imports: [FormsModule],
  templateUrl: './password-dialog.html',
  styleUrl: './password-dialog.scss',
})
export class PasswordDialog implements OnInit {
  protected visible = signal(false);
  protected loading = signal(false);
  protected error = signal(false);
  protected password = '';

  constructor(private passwordService: PasswordService) {}

  async ngOnInit(): Promise<void> {
    const authenticated = await this.passwordService.isAuthenticated();
    if (!authenticated) {
      this.visible.set(true);
    }
  }

  async submit(): Promise<void> {
    if (!this.password || this.loading()) return;
    this.loading.set(true);
    this.error.set(false);

    const success = await this.passwordService.login(this.password);
    if (success) {
      this.visible.set(false);
    } else {
      this.error.set(true);
      this.password = '';
    }
    this.loading.set(false);
  }
}
