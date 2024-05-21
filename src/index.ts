// cannister code goes here
import { v4 as uuidv4 } from 'uuid';
import { Server, StableBTreeMap, ic } from 'azle';
import express from 'express';

class Course {
   id: string;
   creatorName: string;
   creatorAddress: string; // Store the principal
   title: string;
   content: string;
   attachmentURL: string;
   category: string;
   keyword: string;
   contact: string;
   createdAt: Date;
   updatedAt: Date | null
}

class FilterPayload {
  creatorName?: string;
  category?: string;
  keyword?: string;
}

type Result<T, E> = { type: 'Ok'; value: T } | { type: 'Err'; error: E };

function Ok<T>(value: T): Result<T, never> {
  return { type: 'Ok', value };
}

function Err<E>(error: E): Result<never, E> {
  return { type: 'Err', error };
}

// Conver them into persistent memory
const courseStorage = StableBTreeMap<string, Course>(0);
let admin: string;
let moderators: string[];
let bannedUsers: string[];

export default Server(() => {
  const app = express();
  app.use(express.json());

  // Add course
  app.post("/courses", (req, res) => {

    // Check if the user is banned
    const caller = ic.caller().toString();
    if (bannedUsers.includes(caller)) {
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
    const result = update_course(id);
    if (result.type === 'Ok') {
      const course = result.value;
      const updatedMessage = { ...course, ...req.body, updatedAt: getCurrentDate()};
      courseStorage.insert(course.id, updatedMessage);
      res.json(updatedMessage);
    } else {
      res.status(400).send(`couldn't update a course with id=${id}. course not found`);
    }
  });

  // Add admin
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
  app.put("/moderator/:address", (req, res) => {
    const address = req.params.address;
    const result = addModerator(address);
    if (result.type === 'Ok') {
      res.json(result.value);
    } else {
      res.status(400).send(result.error);
    }
  });

  // Remove moderator
  app.put("/removeModerator/:address", (req, res) => {
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
    const result = banUser(address);
    if (result.type === 'Ok') {
      res.json(result.value);
    } else {
      res.status(400).send(result.error);
    }
  });

  // Unban user
  app.put("/unban/:address", (req, res) => {
    const address = req.params.address;
    const result = unBanUser(address);
    if (result.type === 'Ok') {
      res.json(result.value);
    } else {
      res.status(400).send(result.error);
    }
  });

  // Delete course
  app.delete("/courses/:id", (req, res) => {
    const id = req.params.id;
    const result = delete_course(id);
    if (result.type === 'Ok') {
      res.json(result.value);
    } else {
      res.status(400).send(result.error);
    }
  });

  // Delete all my courses course
  app.delete("/courses/", (req, res) => {
    let caller: string = ic.caller.toString();
    const result = delete_all_courses(caller);
    if (result.type === 'Ok') {
      res.json(result.value);
    } else {
      res.status(400).send(result.error);
    }
  });

  // Delete all user courses
  app.delete("/courses/:address", (req, res) => {
    const address = req.params.address;
    const result = delete_courses(address);
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
  if (admin) {
    if(caller == admin ) {
      admin = address;
      return Ok(address);
    }
    return Err("not authorized");
  }
  admin = address;
  return Ok(address);
}

// Add moderator -> only admin can call
function addModerator(address: string): Result<string, string> {
  let caller = ic.caller().toString();

  if(caller != admin ) {
    return Err("not authorized");
  }

  if (moderators.length == 5) {
    return Err("maximum number of moderators added");
  }

  if(address in moderators) {
    return Err("moderator already added");
  }

  moderators.push(address);
  return Ok(address);
}

// Remove a moderator -> only admin can call
function removeModerator(address: string): Result<string, string> {
  const caller = ic.caller().toString();
  if(caller != admin) {
    return Err("You are not authorized to remove a moderator");
  }

  if(!moderators.includes(address)){
    return Err("Provided address is not a moderator");
  }

  const index = moderators.indexOf(address);
  moderators.splice(index);
  return Ok(address);
}

// Either admin or a moderator can access
function banUser(address: string): Result<string, string> {
  const caller = ic.caller.toString();
  if (
    // Check whether the user is authorized
    caller != admin || !moderators.includes(caller) ||

    // Check if the address to be banned is a moderator or admin
    address == admin || moderators.includes(address)
  ) {
    return Err("you are not authorized to ban the user")
  }

  // Delete all the courses of the banned user
  const result = delete_all_courses(address)
  if(result.type ==='Ok') {
    bannedUsers.push(address)
    return Ok(address);
  } else {
    return Err("User has no courses, cannot ban");
  }
}

// can add is authorized helper function
function unBanUser(address: string): Result<string, string> {
  const caller = ic.caller.toString();
  if (
    caller != admin || !moderators.includes(caller) 
  ) {
    return Err("you are not authorized to unban the user")
  }

  if(!bannedUsers.includes(address)) {
    return Err("User is not banned");
  }

  // Remove user from the list of banned users
  const index = bannedUsers.indexOf(address);
  bannedUsers.splice(index);
  return Ok(address);

}

function filterCourses_OR(payload: FilterPayload): Result<Course[], string> {
  if (!payload.keyword && !payload.category && !payload.creatorName) {
      return Err("Filter payload is empty; at least one filter criterion must be provided");
  }

  // Create an empty array
  const courses: Course[] = [];

  // Returns array of tuple values of key and the value
  let items = courseStorage.items();

  // Using for of loop to iterate through the array
  // Destructuring the two entries in each tuple
  for(const [key, course] of items) {
    let matches = false;
    if (payload.keyword) {
      matches = course.keyword == payload.keyword;
    }
    if (payload.category) {
      matches = matches || course.category == payload.category;
    }
    if (payload.creatorName) {
      matches = matches || course.creatorName == payload.creatorName;
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
  
  const courses: Course[] = [];
  
  // Returns array of tuple values of key and the value
  let items = courseStorage.items();

  // Using for of loop to iterate through the array
  // Destructuring the two entries in each tuple
  for(const[key, course] of items) {
    let matches = true;
    if (payload.keyword) {
      matches = matches && course.keyword == payload.keyword;
    }
    if (payload.category) {
      matches = matches && course.category == payload.category;
    }
    if (payload.creatorName) {
      matches = matches && course.creatorName == payload.creatorName;
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
function update_course(id: string): Result<Course, string> {
  let caller = ic.caller().toString();
  const courseOpt = courseStorage.get(id);
  if ("None" in courseOpt) {
     return Err(`couldn't update a course with id=${id}. course not found`);
  } else {
     const course = courseOpt.Some;
    if (caller == admin || moderators.includes(caller) || caller == course.creatorAddress ) {
      return Ok(course)
    } else {
      return Err(`you are not authorized to update the course with id=${id}`)
    }
  }
}

// Either the course creator or the admin or a moderator can delete a course
function delete_course(id: string): Result<Course,string> {
  let caller = ic.caller.toString();
  const courseOpt = courseStorage.get(id);
  if ("None" in courseOpt) {
    return Err(`Course with id=${id} not found`);
  } else {
      const course = courseOpt.Some;
      if (caller == admin || caller ==  course.creatorAddress) {
        courseStorage.remove(id);
        return Ok(course);
      } else {
        return Err(`you are not authorized to delete course with id=${id}`);
      }
  }
}

// Either the course creator or the admin or a moderator can delete a course
function delete_courses(address: string): Result<string[], string> {
  let caller = ic.caller.toString();
  if (caller == admin || moderators.includes(caller) || caller ==  address) {
    return delete_all_courses(address);
  } else {
    return Err(`you are not authorized to delete courses for the address=${address}`);
  }
}

// Helper function to delete all the courses of the input address
function delete_all_courses(address: string): Result<string[], string> {
    let keysOfAddress: string[] = [];
    let items = courseStorage.items();
  
    for (const [key, course] of items) {
      if (course.creatorAddress == address) {
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
