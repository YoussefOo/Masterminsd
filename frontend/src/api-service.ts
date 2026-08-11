export interface UserData {
  id?: number;
  username: string;
  role?: string;
  password?: string;
}

export class ApiService {

  // 1. CREATE (POST) - Neuen Datensatz erstellen
  public static async create(data: UserData): Promise<any> {
    const response = await fetch('/api/users', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(data)
    });

    if (!response.ok) {
      throw new Error(`Fehler beim Erstellen: ${response.statusText}`);
    }
    return await response.json();
  }

  // 2. READ (GET) - Datensätze vom Backend abrufen
  public static async getAll(): Promise<UserData[]> {
    const response = await fetch('/api/users', {
      method: 'GET',
      headers: { 'Accept': 'application/json' }
    });

    if (!response.ok) {
      throw new Error(`Fehler beim Laden: ${response.statusText}`);
    }
    return await response.json();
  }

  // 3. UPDATE (PUT / PATCH) - Bestehenden Datensatz bearbeiten
  public static async update(id: number, updatedData: Partial<UserData>): Promise<any> {
    const response = await fetch(`/api/users/${id}`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(updatedData)
    });

    if (!response.ok) {
      throw new Error(`Fehler beim Aktualisieren: ${response.statusText}`);
    }
    return await response.json();
  }

  // 4. DELETE (DELETE) - Datensatz löschen
  public static async delete(id: number): Promise<boolean> {
    const response = await fetch(`/api/users/${id}`, {
      method: 'DELETE'
    });

    if (!response.ok) {
      throw new Error(`Fehler beim Löschen: ${response.statusText}`);
    }
    return true;
  }
}