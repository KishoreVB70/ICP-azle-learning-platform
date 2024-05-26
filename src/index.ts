// cannister code goes here
import { v4 as uuidv4 } from 'uuid';
import { Server, StableBTreeMap, bool, ic } from 'azle';
import express from 'express';

class Course {
   id: string;
   creatorAddress: string; // Store the principal of the creator
   creatorName: string;
   title: string;
   content: string;
   attachmentURL: string;
   category: string;
   keyword: string;
   contact: string;
   createdAt: Date;
   updatedAt: Date | null
}

// To obtain information for filtering the courses
type FilterPayload = {
  creatorName?: string;
  category?: string;
  keyword?: string;
};

type Result<T, E> = { type: 'Ok'; value: T } | { type: 'Err'; error: E };

function Ok<T>(value: T): Result<T, never> {
  return { type: 'Ok', value };
}

function Err<E>(error: E): Result<never, E> {
  return { type: 'Err', error };
}

// Conver them into persistent memory
const courseStorage = StableBTreeMap<string, Course>(0);
const moderatorsStorage =  StableBTreeMap<string, string>(1);
const bannedUsersStorage = StableBTreeMap<string, string>(2);
const AdminStorage = StableBTreeMap<string, string>(3);

export default Server(() => {
  const app = express();
  app.use(express.json());

  // Add course
  app.post("/courses", (req, res) => {
    const { 
      title, content, creatorName, 
      attachmentURL, category, keyword, contact 
    } = req.body;

    // Input validation
    if (
      !title || !content || !creatorName || 
      !attachmentURL || !category || !keyword || !contact
    ) {
      res.status(400).json({ error: 'Missing required fields' });
      return;
    }

    // Check if the user is banned
    const caller = ic.caller().toString();
    if (isBanned(caller)) {
      res.status(400).send("Cannot add course. User is banned")
    }
    const course: Course =  {
      id: uuidv4(), createdAt: getCurrentDate(),
      creatorAddress: ic.caller().toString(), ...req.body
    };
    courseStorage.insert(course.id, course);
    res.json(course);
  });

  // Get all courses
  app.get("/courses", (req, res) => {
    res.json(courseStorage.values());
  });

  // Filter courses based on two techniques -> AND or OR
  app.get('/courses/filter', (req, res) => {
    const filterType = req.query.filterType as string;
    if(!filterType) {
      res.status(400).send("Provide filter type AND OR");
      return;
    }

    const payload: FilterPayload = {
      keyword: req.query.keyword as string,
      category: req.query.category as string,
      creatorName: req.query.creatorName as string
    };

    let result: Result<Course[], string>;

    if (filterType.toUpperCase() === 'AND') {
      result = filterCourses_And(payload);
    } else if (filterType.toUpperCase() === 'OR') {
      result = filterCourses_OR(payload);
    } else {
      res.status(400).send("filter type must be either AND or OR");
      return;
    }

    if (result.type === 'Ok') {
      res.json(result.value);
    } else {
      res.status(400).send(result.error);
    }
  });

  // Get one course
  app.get("/courses/:id", (req, res) => {
    const courseId = req.params.id;
    const courseOpt = courseStorage.get(courseId);
    if ("None" in courseOpt) {
        res.status(404).send(`the course with id=${courseId} not found`);
    } else {
        res.json(courseOpt.Some);
    }
  });

  // Update course
  app.put("/courses/:id", (req, res) => {
    const id = req.params.id;
    const result = updateCourse(id);
    if (result.type === 'Ok') {
      const course = result.value;
      const updatedMessage = { ...course, ...req.body, updatedAt: getCurrentDate()};
      courseStorage.insert(course.id, updatedMessage);
      res.json(updatedMessage);
    } else {
      res.status(400).send(`couldn't update a course with id=${id}. course not found`);
    }
  });

  // Delete course based on the id
  app.delete("/courses/:id", (req, res) => {
    const id = req.params.id;
    const caller = ic.caller().toString();
    const result = deleteCourse(id, caller);
    if (result.type === 'Ok') {
      res.json(result.value);
    } else {
      res.status(400).send(result.error);
    }
  });

  // Delete all the user courses courses course
  app.delete("/courses/", (req, res) => {
    let caller: string = ic.caller().toString();
    const result = deleteAllCourses(caller);
    if (result.type === 'Ok') {
      res.json(result.value);
    } else {
      res.status(400).send(result.error);
    }
  });

  // Delete all the courses of the address 
  app.delete("/courses/address/:add", (req, res) => {
    const address = req.params.add;
    const caller = ic.caller().toString();
    const result = deleteCourses(address, caller);
    if (result.type === 'Ok') {
      res.json(result.value);
    } else {
      res.status(400).send(result.error);
    }
  });

  // View the admin
  app.get("/admin", (req, res) => {
    const adminValues = AdminStorage.values()
    if (adminValues.length > 0) {
      res.json(adminValues[0]);
    } else {
      res.status(500).send("admin not set");
    }
  });

  // Returns all the moderators
  app.get("/moderators", (req, res) => {  
    res.json(moderatorsStorage.values());
  })

  // Set admin
  app.put("/admin/:address", (req, res) => {
    const address = req.params.address;
    const result = setAdmin(address);
    if (result.type === 'Ok') {
      res.json(result.value);
    } else {
      res.status(400).send(result.error);
    }
  });

  // Add moderator
  app.put("/moderators/:address", (req, res) => {
    const address = req.params.address;
    const result = addModerator(address);
    if (result.type === 'Ok') {
      res.json(result.value);
    } else {
      res.status(400).send(result.error);
    }
  });

  // Remove moderator
  app.delete("/moderators/:address", (req, res) => {
    const address: string = req.params.address;
    const result = removeModerator(address);
    if (result.type === 'Ok') {
      res.json(result.value);
    } else {
      res.status(400).send(result.error);
    }
  })

  // Ban user
  app.put("/ban/:address", (req, res) => {
    const address = req.params.address;
    const caller = ic.caller().toString();
    const result = banUser(address, caller);
    if (result.type === 'Ok') {
      res.json(result.value);
    } else {
      res.status(400).send(result.error);
    }
  });

  // Unban user
  app.delete("/ban/:address", (req, res) => {
    const address = req.params.address;
    const caller = ic.caller().toString();
    const result = unBanUser(address, caller);
    if (result.type === 'Ok') {
      res.json(result.value);
    } else {
      res.status(400).send(result.error);
    }
  });

  return app.listen();
});

// Administration functions
// If not already initialized, only admin can change
function setAdmin(address: string): Result<string, string> {
  let caller: string = ic.caller().toString();
  const items = AdminStorage.items();
  if (items.length > 0) {
    const [key, value] = items[0];
    if(caller === value) {
      AdminStorage.remove(key);
      AdminStorage.insert(uuidv4(),address);
      return Ok(address);
    }
    return Err("not authorized");
  }
  AdminStorage.insert(uuidv4(),address);
  return Ok(address);
}

// Add moderator -> only admin can call
function addModerator(address: string): Result<string, string> {
  let caller = ic.caller().toString();

  let values = AdminStorage.values()

  if(caller != values[0] ) {
    return Err("not authorized");
  }

  // Returns array of tuple containing key and values
  let moderators = moderatorsStorage.values();

  // Maximum number of moderators = 5
  if (moderators.length === 5) {
    return Err("maximum number of moderators added");
  }

  // Check if moderator already present
  for ( const value of moderators) {
    if (value === address) {
      return Err("moderator already added")
    }
  }

  // Add moderator into storage
  moderatorsStorage.insert(uuidv4(), address);
  return Ok(address);
}

function isAdmin(address: string): bool {
  const adminValues = AdminStorage.values();
  return address.toUpperCase() === adminValues[0].toUpperCase();
}

// Remove a moderator -> only admin can call
function removeModerator(address: string): Result<string, string> {
  const caller = ic.caller().toString();
  const value = AdminStorage.values();
  if(caller != value[0]) {
    return Err("You are not authorized to remove a moderator");
  }

  let moderators = moderatorsStorage.items();
  let isModerator: boolean = false;

  // Obtain the id of the address
  let id: string = "";
  for (const [key, value] of moderators) {
    if (value === address) {
      isModerator = true;
      id = key;
      break;
    }
  }

  if(!isModerator){
    return Err("Provided address is not a moderator");
  }

  moderatorsStorage.remove(id);
  return Ok(address);
}

function isModerator(address: string): bool {
  const moderators = moderatorsStorage.values();
  for (const value of moderators) {
    if (value.toUpperCase() === address.toUpperCase()) {
      return true
    }
  }
  return false
}

// Either admin or a moderator can access
function banUser(address: string, caller: string): Result<string, string> {
  const adminValues = AdminStorage.values();
  if (
    // Check whether the user is either the admin or a moderator
    ( caller != adminValues[0] && !isModerator(caller) ) ||

    // Check if the address to be banned is a moderator or admin
    ( address === adminValues[0] || isModerator(address) )
  ) {
    return Err("you are not authorized to ban the user")
  }

  // Delete all the courses of the banned user
  const result = deleteAllCourses(address)
  if(result.type ==='Ok') {
    bannedUsersStorage.insert(uuidv4(), address);
    return Ok(address);
  } else {
    return Err("User has no courses, cannot ban");
  }
}

// can add is authorized helper function
function unBanUser(address: string, caller: string): Result<string, string> {
  let values = AdminStorage.values();
  if (
    caller != values[0] || !isModerator(caller) 
  ) {
    return Err("you are not authorized to unban the user")
  }

  const bannedUsers = bannedUsersStorage.items();

  let isBanned: bool = false;
  let id: string = ""

  for (const [key, value] of bannedUsers) {
    if (value === address) {
      isBanned = true;
      id = key;
    }
  }

  if(!isBanned) {
    return Err("User is not banned");
  }

  // Remove user from the list of banned users
  bannedUsersStorage.remove(id);
  return Ok(address);

}

function isBanned(address: string): bool {
  const bannedUsers = bannedUsersStorage.values();
  for (const value of bannedUsers) {
    if (value === address) {
      return true
    }
  }
  return false;
}

function filterCourses_OR(payload: FilterPayload): Result<Course[], string> {
  if (!payload.keyword && !payload.category && !payload.creatorName) {
      return Err("Filter payload is empty; at least one filter criterion must be provided");
  }

  // Create an empty array
  const courses: Course[] = [];

  // Returns array of all the courses
  let values = courseStorage.values();

  // Using for of loop to iterate through the array
  for(const course of values) {
    let matches = false;
    if (payload.keyword) {
      matches = course.keyword.toUpperCase() === payload.keyword.toUpperCase();
    }
    if (payload.category) {
      matches = matches || course.category.toUpperCase() === payload.category.toUpperCase();
    }
    if (payload.creatorName) {
      matches = matches || course.creatorName.toUpperCase() == payload.creatorName.toUpperCase();
    }
    if (matches) {
      courses.push(course);
    }
  }

  if (courses.length === 0) {
    return Err("not found");
  }
    return Ok(courses);
}

function filterCourses_And(payload: FilterPayload): Result<Course[], string>{
  // Add a separate function to check if payload is empty
  if (!payload.keyword && !payload.category && !payload.creatorName) {
    return Err("Filter payload is empty; at least one filter criterion must be provided");
  }
  
  //Empty array for courses
  const courses: Course[] = [];
  
  // Returns array of courses
  let values = courseStorage.values();

  // Using for of loop to iterate through the array
  // Destructuring the two entries in each tuple
  for(const course of values) {
    let matches = true;
    if (payload.keyword) {
      matches = matches && course.keyword.toUpperCase() === payload.keyword.toUpperCase();
    }
    if (payload.category) {
      matches = matches && course.category.toUpperCase() === payload.category.toUpperCase();
    }
    if (payload.creatorName) {
      matches = matches && course.creatorName.toUpperCase() === payload.creatorName.toUpperCase();
    }
    if (matches) {
      courses.push(course);
    }
  }

  if (courses.length === 0) {
    return Err("No courses");
  }

  return Ok(courses);
}

// Either the course creator or the admin or a moderator can update a course
function updateCourse(id: string): Result<Course, string> {
  let caller = ic.caller().toString();
  const courseOpt = courseStorage.get(id);
  if ("None" in courseOpt) {
     return Err(`couldn't update a course with id=${id}. course not found`);
  } else {
     const course = courseOpt.Some;
     const adminValues = AdminStorage.values();
    if (caller === adminValues[0] || isModerator(caller) || caller === course.creatorAddress ) {
      return Ok(course)
    } else {
      return Err(`you are not authorized to update the course with id=${id}`)
    }
  }
}

// Either the course creator or the admin or a moderator can delete a course
function deleteCourse(id: string, caller: string): Result<Course,string> {
  const courseOpt = courseStorage.get(id);
  if ("None" in courseOpt) {
    return Err(`Course with id=${id} not found`);
  } else {
      const course = courseOpt.Some;
      if (
        isAdmin(caller) || 
        isModerator(caller) ||
        caller.toUpperCase() ===  course.creatorAddress.toUpperCase()
      ) {
        courseStorage.remove(id);
        return Ok(course);
      } else {
        return Err(`you are not authorized to delete course with id=${id}`);
      }
  }
}

// Either the course creator or the admin or a moderator can delete a course
function deleteCourses(address: string, caller: string): Result<string[], string> {
  if (isAdmin(caller) || isModerator(caller) || caller ===  address) {
    return deleteAllCourses(address);
  } else {
    return Err(`you are not authorized to delete courses for the address=${address}`);
  }
}

// Helper function to delete all the courses of the input address
function deleteAllCourses(address: string): Result<string[], string> {
    let keysOfAddress: string[] = [];
    let items = courseStorage.items();
  
    for (const [key, course] of items) {
      if (course.creatorAddress.toUpperCase() === address.toUpperCase()) {
        keysOfAddress.push(key)
      }
    }
    if (keysOfAddress.length > 0){
      for (let id of keysOfAddress) {
        courseStorage.remove(id);
      }
      return Ok(keysOfAddress);
    } else {
      return Err("no courses for the address");
    }
}

function getCurrentDate() {
  const timestamp = new Number(ic.time());
  return new Date(timestamp.valueOf() / 1000_000);
}