import { Component, signal } from '@angular/core';
import { AlbumWall } from "./components/album-wall/album-wall";
import { PasswordDialog } from "./components/password-dialog/password-dialog";
import { PasswordService } from "./services/password.service";

@Component({
  selector: 'app-root',
  imports: [AlbumWall, PasswordDialog],
  templateUrl: './app.html',
  styleUrl: './app.scss',
})
export class App {
  protected readonly title = signal('myMusic');
  protected readonly authenticated;

  constructor(private passwordService: PasswordService) {
    this.authenticated = this.passwordService.authenticated;
  }
}
