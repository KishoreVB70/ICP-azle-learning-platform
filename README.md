# icp_azle_learning_platform
This project is a decentralized learning platform built on the Internet Computer using azle, inspired from medium and dacade. It allows users to create, read, delete, and update courses, with certain roles and permissions to ensure security and proper management.

This project leverages the capabilities of the Internet Computer to provide a decentralized, permission-based system for managing online courses, ensuring robust access control and user management.

### Key Features

1. **Course Management**
   - **Add Course:** Users can add new courses with details like title, creator name, body, attachment URL, keyword, category, and contact information.
   - **Update Course:** Only the creator, admin, or moderators can update a course's details.
   - **Delete Course:** Individial courses can be deleted by the creator, admin, or moderators.
   - **Delete Courses:** Users can delete all their own courses.
   - **Delete Courses of a creator:** Admins and moderators can delete all courses by a specific creator.

2. **Course Filtering**
    - AND based filtering provides the courses which match all of the criterias of the user
    - OR based filtering provided courses whcih match any of the criterias fo the user
   - **Filter Courses (AND Condition):** Retrieve courses that match all provided criteria (keyword, category, creator address).
   - **Filter Courses (OR Condition):** Retrieve courses that match any of the provided criteria (keyword, category, creator address).

3. **User Roles and Permissions**
   - To regulate ill actors, a moderation system is created based on admin access
   - **Admin Management:** 
     - Set or change the admin address.
     - Admin has the highest level of permissions, mainly changing the admin and adding, removing moderators.
   - **Moderator Management:** 
     - Add and remove moderators.
     - Moderators can manage courses(update, delete) and users(ban, unban) but have limited permissions compared to the admin.
   - **Banned Users Management:** 
     - Ban users from adding courses.
     - Unban users.
     - Banning a user also removes all their courses.

### Detailed Functionality

1. **Set Admin**
   - Initializes the admin address if not already set or allows the current admin to change it.

2. **Add Moderator**
   - Allows the admin to add a new moderator, with a maximum of 5 moderators.

3. **Remove Moderator**
   - Allows the admin to remove a moderator.

4. **Get Course**
   - Retrieves a course based on its ID.

4. **Get Courses**
   - Retrieves all courses

5. **Add Course**
   - Allows users to add a new course if they are not banned and have provided all required fields.

6. **Update Course**
   - Allows the course creator, admin, or moderators to update course details.

7. **Delete Course**
   - Allows the course creator, admin, or moderators to delete a course.

8. **Delete Courses by a creator**
   - Allows the admin or moderators to delete all courses by a specific creator.

9. **Delete Courses**
   - Allows users to delete all courses they have created.

10. **Ban Creator**
    - Allows the admin or moderators to ban a user from adding courses and deletes all their courses.

11. **Unban Creator**
    - Allows the admin or moderators to unban a user.

12. **Filter Courses (AND Condition)**
    - Retrieves courses that satisfy all provided filter criteria.

13. **Filter Courses (OR Condition)**
    - Retrieves courses that satisfy any of the provided filter criteria.

### Helper Functions
- **_is_admin:** Checks if a given address is the admin.
- **_is_authorized:** Checks if a given address is either the admin or a moderator or the creator of a specific course.
- **_is_moderator:** Checks if the caller is a moderator.

## Prerequisities

1. Install `nvm`:
- `curl -o- https://raw.githubusercontent.com/nvm-sh/nvm/v0.39.3/install.sh | bash`

2. Switch to node v20:
- `nvm install 20`
- `nvm use 20`

3. Install build dependencies:
## For Ubuntu and WSL2
```
sudo apt-get install podman
```
## For macOS:
```
xcode-select --install
brew install podman
```

4. Install `dfx`
- `DFX_VERSION=0.16.1 sh -ci "$(curl -fsSL https://sdk.dfinity.org/install.sh)"`

5. Add `dfx` to PATH:
- `echo 'export PATH="$PATH:$HOME/bin"' >> "$HOME/.bashrc"`

6. Create a project structure:
- create `src` dir
- create `index.ts` in the `src` dir
- create `tsconfig.json` in the root directory with the next content
```
{
    "compilerOptions": {
        "allowSyntheticDefaultImports": true,
        "strictPropertyInitialization": false,
        "strict": true,
        "target": "ES2020",
        "moduleResolution": "node",
        "allowJs": true,
        "outDir": "HACK_BECAUSE_OF_ALLOW_JS"
    }
}
```
- create `dfx.json` with the next content
```
{
  "canisters": {
    "icp_azle_learning_platform": {
      "type": "custom",
      "main": "src/index.ts",
      "candid": "src/index.did",
      "candid_gen": "http",
      "build": "npx azle icp_azle_learning_platform",
      "wasm": ".azle/icp_azle_learning_platform/icp_azle_learning_platform.wasm",
      "gzip": true,
      "metadata": [
        {
            "name": "candid:service",
            "path": "src/index.did"
        },
        {
            "name": "cdk:name",
            "content": "azle"
        }
    ]
    }
  }
}

```
where `icp_azle_learning_platform` is the name of the canister. 

6. Create a `package.json` with the next content and run `npm i`:
```
{
  "name": "icp_azle_learning_platform",
  "version": "0.1.0",
  "description": "Internet Computer learning platform",
  "dependencies": {
    "@dfinity/agent": "^0.21.4",
    "@dfinity/candid": "^0.21.4",
    "azle": "^0.21.1",
    "express": "^4.18.2",
    "uuid": "^9.0.1"
  },
  "engines": {
    "node": "^20"
  },
  "devDependencies": {
    "@types/express": "^4.17.21"
  }
}

```

7. Run a local replica
- `dfx start --host 127.0.0.1:8000`

#### IMPORTANT NOTE 
If you make any changes to the `StableBTreeMap` structure like change datatypes for keys or values, changing size of the key or value, you need to restart `dfx` with the `--clean` flag. `StableBTreeMap` is immutable and any changes to it's configuration after it's been initialized are not supported.
- `dfx start --host 127.0.0.1:8000 --clean`

8. Deploy a canister
- `dfx deploy`
Also, if you are building an HTTP-based canister and would like your canister to autoreload on file changes (DO NOT deploy to mainnet with autoreload enabled):
```
AZLE_AUTORELOAD=true dfx deploy
```

9. Stop a local replica
- `dfx stop`

## Interaction with the canister

When a canister is deployed, `dfx deploy` produces a link to the Candid interface in the shell output.

Candid interface provides a simple UI where you can interact with functions in the canister.

On the other hand, you can interact with the canister using `dfx` via CLI:

### get canister id:
- `dfx canister id <CANISTER_NAME>`
Example:
- `dfx canister id icp_azle_learning_platform`
Response:
```
bkyz2-fmaaa-aaaaa-qaaaq-cai
```

Now, the URL of your canister should like this:
```
http://bkyz2-fmaaa-aaaaa-qaaaq-cai.localhost:8000
```

With this URL, you can interact with the canister using an HTTP client of your choice. We are going to use `curl`.

### create a course:
- `curl -X POST <CANISTER_URL>/<REQUEST_PATH> -H "Content-type: application/json" -d <PAYLOAD>`
Example: 
```
curl -X POST http://bkyz2-fmaaa-aaaaa-qaaaq-cai.localhost:8000/courses  -H "Content-type: application/json" -d '{
    "title": "How to create a Typescript azle project",
    "content": "abc",
    "creatorName": "kishore",
    "attachmentURL": "url/",
    "category": "programming", 
    "keyword": "azle",
    "contact": "github.com/kishorevb70"
}'
```

### update a course:
- `curl -X PUT <CANISTER_URL>/<REQUEST_PATH>/<COURSE_ID> -H "Content-type: application/json" -d <PAYLOAD>`
Example (In this case we include a course id in the payload to identify the course we want to update): 
```
curl -X PUT http://bkyz2-fmaaa-aaaaa-qaaaq-cai.localhost:8000/courses/a97e22d2-bd33-4d55-a6ff-dd0e13468936  -H "Content-type: application/json" -d '{
    "title": "How to create a Typescript azle project",
    "content": "abc",
    "creatorName": "kishore",
    "attachmentURL": "url/",
    "category": "programming", 
    "keyword": "Azle",
    "contact": "github.com/kishorevb70"
}'
```

### get all courses:
- `curl <CANISTER_URL>/<REQUEST_PATH>`
Example:
- `curl http://bkyz2-fmaaa-aaaaa-qaaaq-cai.localhost:8000/courses`

### get a course:
- `curl <CANISTER_URL>/<REQUEST_PATH>/<COURSE_ID>`
Example (here we only provide a course id):
- `curl http://bkyz2-fmaaa-aaaaa-qaaaq-cai.localhost:8000/messages/d8326ec8-fe70-402e-8914-ca83f0f1055b`

### delete a course:
- `curl -X DELETE <CANISTER_URL>/<REQUEST_PATH>/<COURSE_ID>`
Example (here we only provide a course id):
```
curl -X DELETE http://bkyz2-fmaaa-aaaaa-qaaaq-cai.localhost:8000/courses/a97e22d2-bd33-4d55-a6ff-dd0e13468936
```

### filter courses
```
curl "http://bkyz2-fmaaa-aaaaa-qaaaq-cai.localhost:8000/courses/filter?filterType=OR&keyword=azle&category=programming&creatorName=kishore"
```